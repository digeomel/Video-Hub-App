import { Component, Input, OnInit, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';

import { ImageElement, ScreenshotSettings, InputSources } from '../../../../interfaces/final-object.interface';

import { ElectronService } from '../../providers/electron.service';

@Component({
  selector: 'app-statistics',
  templateUrl: './statistics.component.html',
  styleUrls: [
    '../wizard-button.scss',
    './statistics.component.scss',
    './toggle.scss'
  ]
})
export class StatisticsComponent implements OnInit {

  @Output() finalArrayNeedsSaving = new EventEmitter<any>();
  @Output() addMissingThumbnailsPlease = new EventEmitter<any>();

  @Input() finalArray: ImageElement[];
  @Input() hubName: string;
  @Input() inputFolders: InputSources;
  @Input() numFolders: number;
  @Input() pathToVhaFile: string;
  @Input() screenshotSettings: ScreenshotSettings;
  @Input() videoFolder: string;

  totalFiles: number;

  longest: number = 0;
  shortest: number = Infinity;
  totalLength: number = 0;
  avgLength: number;

  largest: number = 0;
  smallest: number = Infinity;
  totalSize: number = 0;
  avgSize: number;

  removeFoldersMode: boolean = false;

  objectKeys = Object.keys; // to use in template

  constructor(
    public cd: ChangeDetectorRef,
    public electronService: ElectronService
  ) { }

  ngOnInit() {

    console.log(this.inputFolders);

    this.finalArray.forEach((element: ImageElement): void => {
      this.shortest = Math.min(element.duration, this.shortest);
      this.longest = Math.max(element.duration, this.longest);
      this.totalLength += element.duration;

      this.smallest = Math.min(element.fileSize, this.smallest);
      this.largest = Math.max(element.fileSize, this.largest);
      this.totalSize += element.fileSize;
    });

    this.totalFiles = this.finalArray.length;

    this.avgLength = Math.round(this.totalLength / this.totalFiles);
    this.avgSize = Math.round(this.totalSize / this.totalFiles);

    this.electronService.ipcRenderer.on('input-folder-chosen', (event, filePath) => {
      console.log('chosen: ', filePath);

      let pathAlreadyExists = false;

      Object.keys(this.inputFolders).forEach((key: string) => {
        if (this.inputFolders[key].path === filePath) {
          pathAlreadyExists = true;
        }
      });

      if (!pathAlreadyExists) {
        const nextIndex: number = this.pickNextIndex(this.inputFolders);
        this.inputFolders[nextIndex] = { path: filePath, watch: false };
        this.electronService.ipcRenderer.send('start-watching-folder', nextIndex, filePath, false);
      }

      this.cd.detectChanges();

    });
  }

  /**
   * Determine and return the next index for inputSource
   * Simply the next integer larger than the largest currently used index
   * @param inputSource
   */
  pickNextIndex(inputSource: InputSources) {
    const indexesAsStrings: string[] = Object.keys(inputSource);
    const indexesAsNumbers: number[] = indexesAsStrings.map((item: string) => parseInt(item, 10));

    return Math.max(...indexesAsNumbers) + 1;
  }

  /**
   * Notify Node of watch status change
   * toggled via checkbox input in template
   */
  folderWatchStatusChange(index: number, shouldWatch: boolean) {
    this.finalArrayNeedsSaving.emit(true);
    console.log(index);
    console.log(shouldWatch);
    if (shouldWatch) {
      console.log(this.inputFolders[index].path);
      this.tellNodeStartWatching(index, this.inputFolders[index].path, shouldWatch);
    } else {
      this.tellNodeStopWatching(index);
    }
  }

  /**
   * Single scan to add any new videos
   * @param index
   */
  rescanFolder(index: number) {
    console.log(index);
    console.log(this.inputFolders[index].path);
    this.tellNodeStartWatching(index, this.inputFolders[index].path, false);
    setTimeout(() => {
      this.cd.detectChanges(); // to update template whether to show "Rescan" or not
    }, 1);
  }

  /**
   * Add any missing thumbnails / continue thumbnail import
   */
  addMissingThumbnails() {
    this.addMissingThumbnailsPlease.emit();
  }

  /**
   * Summon system modal to select folder
   */
  addAnotherFolder() {
    this.electronService.ipcRenderer.send('choose-input');
  }

  /**
   * Delete an item source
   * @param itemSourceKey
   */
  deleteInputSource(itemSourceKey: number) {
    console.log(itemSourceKey);
    console.log(this.inputFolders[itemSourceKey]);
    this.tellNodeStopWatching(itemSourceKey);
    delete this.inputFolders[itemSourceKey];
  }

  /**
   * Tell node to stop watching a particular folder
   * @param itemSourceKey from InputSources
   */
  tellNodeStopWatching(itemSourceKey: number) {
    this.electronService.ipcRenderer.send('stop-watching-folder', itemSourceKey);
  }

  /**
   * Tell node to start watching a particular folder
   * @param itemSourceKey from InputSources
   */
  tellNodeStartWatching(itemSourceKey: number, path: string, persistent: boolean) {
    this.electronService.ipcRenderer.send('start-watching-folder', itemSourceKey, path, persistent);
  }

  trackByFn(index, item) {
    return(item.key);
  }

}
