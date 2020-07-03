// async & chokidar Code written by Cal2195
// Was originally added to `main-extract.ts` but was moved here for clarity

const async = require('async');
const chokidar = require('chokidar');
import * as path from 'path';
import { FSWatcher } from 'chokidar'; // probably the correct type for chokidar.watch() object
import { Stats } from 'fs';

import { GLOBALS } from './main-globals';

import { ImageElement, ImageElementPlus, NewImageElement } from '../interfaces/final-object.interface';
import { acceptableFiles } from './main-filenames';
import { extractAll } from './main-extract';
import { sendCurrentProgress, insertTemporaryFieldsSingle, extractMetadataAsync, cleanUpFileName } from './main-support';

// =========================================================================================================================================
// Thum extraction queue runner
// WARNING - state variable hanging around!
let thumbQueue; // will be `QueueObject` - https://caolan.github.io/async/v3/docs.html#QueueObject
let thumbsDone = 0;
// ========================================================

startNewQueue();

/**
 * Create a new (empty) queue for extracting thumbnails
 */
function startNewQueue() {
  thumbsDone = 0;
  thumbQueue = async.queue(thumbQueueRunner, 1); // 1 is the number of threads

  thumbQueue.drain(() => {
    thumbsDone = 0;
    sendCurrentProgress(1, 1, 'done');              // TODO: reconsider `sendCurrentProgress` since we are using a new system for extraction
    console.log('thumbnail extraction complete!');
  });
}

/**
 * Extraction queue runner
 * Runs for every element in the `thumbQueue`
 * @param element -- ImageElement to extract screenshots for
 * @param done    -- callback to indicate the current extraction finished
 */
function thumbQueueRunner(element: ImageElement, done) {
  const screenshotOutputFolder: string = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName);

  sendCurrentProgress(thumbsDone, thumbsDone + thumbQueue.length() + 1, 'importingScreenshots');      // check whether sending data off by 1
  thumbsDone++;                                                       // TODO -- rethink the whole `sendCurrentProgress` system from scratch

  extractAll(
    element,
    GLOBALS.selectedSourceFolders[element.inputSource].path,
    screenshotOutputFolder,
    GLOBALS.screenshotSettings,
    true,
    done
  );
}

export function stopThumbExtraction() {
  thumbQueue.kill();
  startNewQueue();
}

// =========================================================================================================================================
// Metadata extractin queue runner
// WARNING - state variables hanging around!
const metadataQueue = async.queue(metadataQueueRunner, 1); // 1 is the number of parallel worker functions
                                                           // ^--- experiment with numbers to see what is fastest (try 8)

// Create maps where the value = 1 always.
// It is faster to check if key exists than searching through an array.
let alreadyInAngular: Map<string, number> = new Map(); // full paths to videos we have metadata for in Angular

let watcherMap: Map<number, FSWatcher> = new Map();
// ========================================================

export interface TempMetadataQueueObject {
  fullPath: string;
  inputSource: number;
  name: string;
  partialPath: string;
  stat: Stats;
}

/**
 * Send element back to Angular; if any screenshots missing, queue it for extraction
 * @param imageElement
 */
export function sendNewVideoMetadata(imageElement: ImageElementPlus) {

  alreadyInAngular.set(imageElement.fullPath, 1);

  delete imageElement.fullPath; // downgrade to `ImageElement` from `ImageElementPlus`

  const elementForAngular = insertTemporaryFieldsSingle(imageElement);
  GLOBALS.angularApp.sender.send('new-video-meta', elementForAngular);

  // PROBABLY BETTER DONE ELSEWHERE !!!!
  const screenshotOutputFolder: string = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName);

  if (!hasAllThumbs(imageElement.hash, screenshotOutputFolder, GLOBALS.screenshotSettings.clipSnippets > 0 )) {
    thumbQueue.push(imageElement);
  }
}

/**
 * Create empty element, extract and update metadata, send over to Angular
 * @param fileInfo - various stat metadata about the file
 * @param done
 */
export function metadataQueueRunner(file: TempMetadataQueueObject, done) {

  const newElement = NewImageElement();
  extractMetadataAsync(file.fullPath, GLOBALS.screenshotSettings, newElement, file.stat)
    .then((imageElement: ImageElementPlus) => {
      imageElement.cleanName = cleanUpFileName(file.name);
      imageElement.fileName = file.name;
      imageElement.fullPath = file.fullPath; // insert this converting `ImageElement` to `ImageElementPlus`
      imageElement.inputSource = file.inputSource;
      imageElement.partialPath = file.partialPath;
      sendNewVideoMetadata(imageElement);
      done();
    }, () => {
      done(); // error, just continue
    });

}

/**
 * Create a new `chokidar` watcher for a particular directory
 * @param inputDir
 * @param inputSource -- the number corresponding to the `inputSource` in ImageElement -- must be set!
 * @param persistent  -- whether to continue watching after the initial scan
 */
export function startFileSystemWatching(
  inputDir: string,
  inputSource: number,
  persistent: boolean
) {

  console.log('starting watcher ', inputSource);

  const watcherConfig = {
    alwaysStat: true,
    awaitWriteFinish: true,
    cwd: inputDir,
    // usePolling: true, // may be neccessary for watching files over network ??!?!?!??! -- inspect!
    ignored: '**/vha-*/**', // maybe ignore files that start with `._` ? WTF MAC!?
    persistent: persistent,
  }

  // One-liner for current directory
  const watcher: FSWatcher = chokidar.watch('**', watcherConfig)
    .on('add', (filePath: string, stat) => {

      const ext = filePath.substring(filePath.lastIndexOf('.') + 1);

      if (filePath.indexOf('vha-') !== -1 || acceptableFiles.indexOf(ext) === -1) {
        return;
      }

      const subPath = ('/' + filePath.replace(/\\/g, '/')).replace('//', '/');
      const partialPath = subPath.substring(0, subPath.lastIndexOf('/'));
      const fileName = subPath.substring(subPath.lastIndexOf('/') + 1);
      const fullPath = path.join(inputDir, partialPath, fileName);

      console.log(fullPath);

      if (alreadyInAngular.has(fullPath)) {
        return;
      }

      console.log('not found, creating:');

      const newItem: TempMetadataQueueObject = {
        fullPath: fullPath,
        inputSource: inputSource,
        name: fileName,
        partialPath: partialPath,
        stat: stat,
      }

      metadataQueue.push(newItem);
    })
    .on('unlink', (filePath: string) => {
      console.log(' !!! FILE DELETED:', filePath);
      console.log('TODO - UPDATE ANGULAR');
    })
    .on('unlinkDir', (folderPath: string) => {
      console.log(' !!!!! DIRECTORY DELETED:', folderPath);
      console.log('TODO - UPDATE ANGULAR');
    })
    .on('error', (error) => {
      console.log('!!!!! ERROR !!!!');
      console.log(error);
    })
/*
    .on('all', (event, filePath) => {
      console.log(event, filePath);
    })
*/
    .on('ready', () => {
      console.log('Finished scanning', inputSource);
      if (persistent) {
        console.log('^^^^^^^^ - CONTINUING to watch this directory!');
      } else {
        console.log('^^^^^^^^ - stopping watching this directory');
      }
    });

    watcherMap.set(inputSource, watcher);

}

/**
 * Close out all the wathers
 * reset the alreadyInAngular
 * @param finalArray
 */
export function resetWatchers(finalArray: ImageElement[]): void {

  // close every old watcher
  Array.from(watcherMap.keys()).forEach((key: number) => {
    closeWatcher(key);
  });

  alreadyInAngular = new Map();

  finalArray.forEach((element: ImageElement) => {
    const fullPath: string = path.join(
      GLOBALS.selectedSourceFolders[element.inputSource].path,
      element.partialPath,
      element.fileName
    );

    alreadyInAngular.set(fullPath, 1);
  });
}

/**
 * Close the old watcher
 * happens when opening a new hub (or user toggles the `watch` near folder)
 * @param inputSource
 */
export function closeWatcher(inputSource: number): void {
  console.log('stop watching', inputSource);
  if (watcherMap.has(inputSource)) {
    console.log('closing ', inputSource);
    watcherMap.get(inputSource).close().then(() => {
      console.log(inputSource, ' closed!');
      // do nothing
    });
  }
}

/**
 * Start old watcher
 * happens when user toggles the `watch` near folder
 * @param inputSource
 * @param folderPath
 */
export function startWatcher(inputSource: number, folderPath: string, persistent: boolean): void {
  console.log('start watching !!!!', inputSource, folderPath, persistent);

  GLOBALS.selectedSourceFolders[inputSource] = {
    path: folderPath,
    watch: persistent,
  }

  startFileSystemWatching(folderPath, inputSource, persistent);

}


// ============ REGENERATE SCREENSHOTS

const fs = require('fs');

/**
 * Check if thumbnail, flimstrip, and clip is present
 * return boolean
 * @param fileHash           - unique identifier of the file
 * @param screenshotFolder   - path to where thumbnails are
 * @param shouldExtractClips - whether or not to extract clips
 */
export function hasAllThumbs(
  fileHash: string,
  screenshotFolder: string,
  shouldExtractClips: boolean
): boolean {
  return fs.existsSync(path.join(screenshotFolder, '/thumbnails/', fileHash + '.jpg'))
      && fs.existsSync(path.join(screenshotFolder, '/filmstrips/', fileHash + '.jpg'))
      && (shouldExtractClips ? fs.existsSync(path.join(screenshotFolder, '/clips/', fileHash + '.mp4')) : true);
}

/**
 * Generate indexes for any files missing thumbnails
 * @param fullArray          - ImageElement array
 * @param screenshotFolder   - path to where thumbnails are stored
 * @param shouldExtractClips - boolean -- whether user wants to extract clips or not
 */
export function extractAnyMissingThumbs(
  fullArray: ImageElement[],
  screenshotFolder: string,
  shouldExtractClips: boolean
): void {
  fullArray.forEach((element: ImageElement) => {
    if (!hasAllThumbs(element.hash, screenshotFolder, shouldExtractClips)) {
      console.log('thumb missing -', element.fileName);
      thumbQueue.push(element);
    }
  });
}
