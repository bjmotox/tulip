/*
  ---------------------------------------------------------------------------
  Define the application object as a singleton

  This class is the main IO interface between the user an the application

  Logically the Heirarchy of Application structure is:
    -> Application
     Modules:
     -> Mapping
      -> Roadbook
       -> Waypoint
        -> Tulip
         -> TrackEditor

    The Application handles bootstrapping the user interface and any non Mapping
    function. The UI is mainly composed of the UI Map which is managed by the
    MapEditor object. The Map Editor creates Waypoints based off interaction.
    Each Waypoint has a Tulip which is uses the TrackEditor class to handle the complexity
    of editing tracks.
  ---------------------------------------------------------------------------
*/
var App = Class({
  // singleton: true,

  create: function(){
    /*
      declare some state instance variables
    */
    this.glyphPlacementPosition = {top: 30,left: 30};
    this.canEditMap = true;
    //Dialogs for file IO
    this.dialog = require('electron').remote.dialog;
    /*
      instantiate the roadbook
    */
    this.roadbook = new Roadbook();

    /*
      instantiate import/export
    */
    this.io = new Io();

    /*
      file io
    */
    this.fs = require('fs');
    /*
      IPC to Main process
    */
    this.ipc = require('electron').ipcRenderer; //TODO try require('ipcRenderer')
    /*
      initialize UI listeners
    */
    this.initListeners();
    this.mapControls = MapControls.instance();
    this.glyphControls = GlyphControls.instance();
  },

  /*
    ---------------------------------------------------------------------------
    App persistence
    TODO create a persistence module and move this into it.
    ---------------------------------------------------------------------------
  */
  canEditMapPoints: function(){
    return this.roadbook.currentlyEditingWaypoint == null;
  },

  canExport: function(){
    var can;
    can = this.roadbook.filePath != null;
    return can
  },

  canSave: function(){
    var can;
    can = this.roadbook.finishWaypointEdit();
    can = can || this.roadbook.newWaypoints;
    can = can || this.roadbook.finishNameDescEdit();
    return can;
  },

  openRoadBook: function(){
    var _this = this;
    this.dialog.showOpenDialog({ filters: [
       { name: 'tulip', extensions: ['tlp'] }
      ]},function (fileNames) {
      var fs = require('fs');
      if (fileNames === undefined) return;
        //TODO this needs to be passed to create when choice is added
        //we need to figure out how to watch a file while it's being edited so if it's moved it gets saved to the right place ***fs.watch***
        var fileName = fileNames[0];
        _this.fs.readFile(fileName, 'utf-8', function (err, data) {
          var json = JSON.parse(data);
          // We need to ask whether they want to open a new roadbook or append an existing one to the currently
          // being edited RB
          _this.roadbook.appendRouteFromJSON(json,fileName); //TODO this needs to only pass json once choice is added
          console.log(json);
        });
        $('#toggle-roadbook').click();
        $('.off-canvas-wrap').foundation('offcanvas', 'hide', 'move-left');
        $('#print-roadbook').removeClass('disabled')
        $('#export-gpx').removeClass('disabled')
    });
  },

  // NOTE: this is just to avoid breaking changes for v1.2b, it should come out in the next release
  fixGlyphPaths: function(path){
    return path.replace(/features|orga|details|tracks/, 'glyphs')
  },

  exportGPX: function(callback){
    var gpx = this.io.exportGPX();
    var filename = this.roadbook.filePath.replace('tlp','gpx');
    this.fs.writeFile(filename, gpx, function (err) {});
    callback();
  },

  importGPX: function(){
    var _this = this;
    this.dialog.showOpenDialog({ filters: [
       { name: 'import gpx', extensions: ['gpx'] }
      ]},function (fileNames) {
      var fs = require('fs');
      if (fileNames === undefined) return;
      _this.startLoading();
      $('.off-canvas-wrap').foundation('offcanvas', 'hide', 'move-left');
      var fileName = fileNames[0];
      _this.fs.readFile(fileName, 'utf-8', function (err, data) {
        _this.io.importGPX(data);
      });
    });
  },

  printRoadbook: function(callback){
    this.ipc.send('ignite-print',app.roadbook.statelessJSON());
    callback();
  },

  saveRoadBook: function(){
    if(this.roadbook.filePath == null){
      // Request documents directory path from node
      this.ipc.send('get-documents-path');
    } else {
      this.fs.writeFile(this.roadbook.filePath, JSON.stringify(this.roadbook.statefulJSON(), null, 2), function (err) {});
    }
  },

  saveRoadBookAs: function(){
    if(this.roadbook.filePath == null){
      // Request documents directory path from node TODO we really only need to do this once...
      this.ipc.send('get-documents-path');
    } else {
      this.showSaveDialog('Save roadbook as',this.roadbook.filePath)
    }
  },

  setMapCenter: function(latLng){
    this.map.setCenter(latLng);
    google.maps.event.trigger(this.map,'resize')
  },

  setMapZoom: function(zoom){
    this.map.setZoom(zoom);
    google.maps.event.trigger(this.map,'resize')
  },

  showSaveDialog: function(title,path) {
    var _this = this;
    this.dialog.showSaveDialog({
                                title: title,
                                defaultPath: path,
                                filters: [{ name: 'tulip', extensions: ['tlp'] }]
      },function (fileName) {
      if (fileName === undefined) return;
        // assign the file path to the json for first time players
        // TODO figure out what to do if the user changes the name of the file
        var tulipFile = _this.roadbook.statefulJSON();
        tulipFile.filePath = fileName;
        _this.roadbook.filePath = fileName;
        tulipFile = JSON.stringify(tulipFile, null, 2);
        _this.fs.writeFile(fileName, tulipFile, function (err) {});
        return true
    });
  },

  startLoading: function(){
    $('#loading').show();
    google.maps.event.addListener(this.map, 'idle', this.stopLoading);
  },

  stopLoading: function(){
    $('#loading').hide();
  },

  initMap: function(){
    this.mapEditor = new MapEditor();
    this.map = this.mapEditor.map;
    this.placeMapAttribution();
  },

  /*
    Get the Google Maps attribution elements and attaches them to the content container instead of the map container so that
    we can rotate the map and still appropriately display attribution
  */
  placeMapAttribution: function(){
    var _this = this;
    this.missingAttribution = true;
    google.maps.event.addListener(this.map, 'tilesloaded', function() {
      if(this.missingAttribution){
        var m = $('#map div.gm-style').children('div'); //get the contents of the map container
        m = m.toArray();
        m.shift(); //remove the map but keep the attribution elements
        $('.content-container').append($(m));
        _this.missingAttribution = false;
      }
    });
  },

  /*
    ---------------------------------------------------------------------------
    Roadbook Listeners
    ---------------------------------------------------------------------------
  */
  initListeners: function(){

    var _this = this
    $('#draw-route').click(function(){
      _this.canEditMap = !_this.canEditMap;
      $(this).toggleClass('secondary');
      var markers = _this.mapEditor.routeMarkers;
      for(i=0;i<markers.length;i++){
        if(_this.canEditMap){
          markers[i].setDraggable(true);
        } else {
          markers[i].setDraggable(false);
        }
      }
    });

    $("#import-gpx").click(function(){
      _this.importGPX();
    });

    $('#toggle-roadbook').click(function(){
      $('.roadbook-container').toggleClass('collapsed');
      $('.roadbook-container').toggleClass('expanded');

      $('#toggle-roadbook i').toggleClass('fi-arrow-down');
      $('#toggle-roadbook i').toggleClass('fi-arrow-up');
      $(this).blur();
    });

    $('#export-gpx').click(function(){
      if(_this.canExport()){
        _this.exportGPX(function(){
          $('.off-canvas-wrap').foundation('offcanvas', 'hide', 'move-left');
          alert('You gpx has been exported to the same directory you saved your roadbook')
        });
      } else {
        alert('You must save your roadbook before you can export GPX tracks');
      }
    });

    $('#new-roadbook').click(function(){
      //TODO Something less hacky please
      location.reload();
    });

    $('#open-roadbook').click(function(){
      _this.openRoadBook();
    });

    $('#print-roadbook').click(function(){
      if(_this.canExport()){
        _this.printRoadbook(function(){
          $('.off-canvas-wrap').foundation('offcanvas', 'hide', 'move-left');
        });
      } else {
        alert('You must save your roadbook before you can export it as a PDF');
      }
    });

    $('#save-roadbook').click(function(e){
      e.preventDefault();
      console.log(e);
      if(_this.canSave()){
        $(this).addClass('secondary');
        if(e.shiftKey){
          _this.saveRoadBookAs();
        }else {
          _this.saveRoadBook();
        }
      }
      $(this).blur();
    });

    $('#roadbook-desc, #roadbook-name').find('a.show-editor').click(function(){
      $(this).hide();
      $(this).siblings('.hide-editor').show();
      $(this).siblings('.roadbook-header-input-container').slideDown('fast');
      if($(this).hasClass('rb-name')){
        $(this).parent('div').find(':input').focus();
      }
      if($(this).hasClass('rb-desc')){
        $('#roadbook-desc p').slideUp('fast');
        _this.roadbook.descriptionTextEditor.focus();
      }
      $('#save-roadbook').removeClass('secondary');
      _this.roadbook.editingNameDesc = true;
    });

    $('#roadbook-desc, #roadbook-name').find('a.hide-editor').click(function(){
      $(this).hide();
      $(this).siblings('.show-editor').show();
      $(this).siblings('.roadbook-header-input-container').slideUp('fast');
      if($(this).hasClass('rb-desc')){
        $('#roadbook-desc p').slideDown('fast');
      }
    });

    /*
      Waypoint palette
    */
    $('#hide-palette').click(function(){
      _this.roadbook.finishWaypointEdit();
    });

    $('#orient-map').click(function(){
      var i = _this.roadbook.currentlyEditingWaypoint.mapVertexIndex;
      if(i > 0){
        var heading = google.maps.geometry.spherical.computeHeading(_this.mapEditor.routePoints.getAt(i-1), _this.mapEditor.routePoints.getAt(i));
        if(_this.mapControls.rotation == 0){
          _this.mapControls.disableMapInteraction();
          _this.mapControls.rotation = 360-heading
          _this.mapControls.rotateNumDegrees(_this.mapControls.rotation);
        }else {
          _this.mapControls.reorient();
          _this.mapControls.enableMapInteraction();
        }
      }
    });

    $('.track-grid').click(function(){
      if($(this).hasClass('undo')){
        _this.roadbook.currentlyEditingWaypoint.tulip.removeLastTrack();
        return
      }
      var angle = $(this).data('angle');
      _this.roadbook.currentlyEditingWaypoint.tulip.addTrack(angle);
    });

    $('.track-selector').click(function() {
      if('off-piste-added' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointAdded('offPiste')
      }else if('track-added' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointAdded('track')
      }else if('road-added' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointAdded('road')
      }else if('off-piste-entry' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointEntry('offPiste')
      }else if('track-entry' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointEntry('track')
      }else if('road-entry' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointEntry('road')
      }else if('off-piste-exit' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointExit('offPiste')
      }else if('track-exit' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointExit('track')
      }else if('road-exit' == $(this).attr('id')){
        _this.roadbook.changeEditingWaypointExit('road')
      }
      $('#track-selection-modal').foundation('reveal', 'close');
    });

    /*
      We're adding IPC listeners in here I guess eh?

      This super duper needs to be cleaned up
    */
    // Listener to get path to documents directory from node for saving roadbooks
    // NOTE only use this for roadbooks which haven't been named
    this.ipc.on('documents-path', function(event, arg){
      var path = arg+'/';
      path += _this.roadbook.name() == 'Name your roadbook' ? 'Untitled' : _this.roadbook.name().replace(' ', '-')
      _this.showSaveDialog('Save roadbook', path)
    });
  },
});
