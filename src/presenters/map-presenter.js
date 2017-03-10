/*
  A module for providing the application with the means to control the map via the UI
*/
// TODO refactor this to use MVC pattern and act as a controller for the map model
class MapPresenter{

  constructor(model){
    //NOTE dependencies app.map[setZoom,setOptions,setMapTypeId], app, app.mapModel[routePoints,routeMarkers,]
    // TODO reduce this to only publishing to the MapModel the map should be moved to live here(maybe).
    this.model = model;
    // this.map = model.map;
    this.rotation = 0;
    this.lockedBeforeWaypointEdit = false;
    this.mapUnlocked = true;
    this.displayEdge = true; //displayEdge is a instance variable which tracks whether a handle should be shown when the user hovers the mouse over the route. (think of a better name and nuke this comment)
    this.routeMarkers = [];
    this.deleteQueue = [];
    this.dialog = require('electron').remote.dialog;

    this.initMap();
    this.initRoutePolyline();
    this.attemptGeolocation();

    this.bindToModel();
    this.bindToUI();
    this.bindToMapSurface();
    this.bindToMapPolyline();
  }

  initMap(){
    this.map = new google.maps.Map(document.getElementById('map'), {
       center: {lat: 36.068209, lng: -105.629669},
       zoom: 4,
       disableDefaultUI: true,
       mapTypeId: google.maps.MapTypeId.HYBRID,
    });
  }

  initRoutePolyline(){
    this.routePolyline = new google.maps.Polyline({
      strokeColor: '#ffba29',
      strokeOpacity: 1.0,
      strokeWeight: 6,
      map: this.map,
    });
  }

  attemptGeolocation(){
    var _this = this;
    var url = "https://www.googleapis.com/geolocation/v1/geolocate?key="+ api_keys.google_maps;
    $.post(url,function(data){
      _this.setMapCenter(data.location);
      _this.setMapZoom(14);
    });
  }

  setMapCenter(latLng){
    this.map.setCenter(latLng);
  }

  setMapZoom(zoom){
    this.map.setZoom(zoom);
  }

  getMapZoom(){
    return this.map.getZoom();
  }

  zin(){
    this.map.setZoom(this.map.getZoom() + 1);
  }

  zout(){
    this.map.setZoom(this.map.getZoom() - 1);
  }

  rotateNumDegrees(degrees){
    $('#map').css({'-webkit-transform' : 'rotate('+ degrees +'deg)'});
    $('#draw-route').hide();
    $('.map-rotate-notice').show();
    $('.map-rotate-notice').fadeTo('slow', 0.25).fadeTo('slow', 1.0);
    this.map.setOptions({draggable: false});
  }

  reorient(){
    this.rotation = 0;
    $('#map').css({'-webkit-transform' : 'rotate(0deg)'});
    $('.map-rotate-notice').hide();
    $('#draw-route').show('slow');
    this.map.setOptions({draggable: true});
  }

  toggleMapLock(element){
    this.mapUnlocked = !this.mapUnlocked;
    this.lockedBeforeWaypointEdit = !this.mapUnlocked;
    this.lockedBeforeWaypointEdit = !this.mapUnlocked;
    element ? $(element).toggleClass('secondary') : null;
  }

  orientMap(){
    this.lockedBeforeWaypointEdit = !this.mapUnlocked;
    var bearing = this.model.getWaypointBearing();
    if(bearing){
      if(this.rotation == 0){
        this.toggleMapLock();
        this.rotation = 360-bearing
        this.rotateNumDegrees(this.rotation);
      }else {
        this.reorient();
        this.toggleMapLock();
      }
    }
  }

  updateLayerDropdown(element){
    $('#layers-dropdown').find('i').hide();
    $(element).parent('li').siblings('li').find('a').removeClass('selected');
    $(element).addClass('selected');
    $(element).find('i').show();
  }

  updateWaypointBubble(routePointIndex,bubble){
    if(this.routeMarkers[routePointIndex].bubble){
      this.routeMarkers[routePointIndex].bubble.setRadius(Number(bubble));
    }
  }
  /*
    Adds a point to the route path points array for manangement
    Since route path points is an MVCArray bound to the route path
    the new point will show up on the route Polyline automagically.

    Listeners are bound to the point to allow it to be toggled as a waypoint or to be removed entirely
    // TODO make a seperate function for markers
  */
  pushRoutePoint(latLng,supressWpt){
    this.routePolyline.getPath().push(latLng);

    var marker = this.buildRouteMarker(latLng);

    this.bindToMapMarker(marker);

    this.routeMarkers.push(marker);
    // this is the first point and thus the start of the route, make it a waypoint, but not if the roadbook is being loaded from js
    return marker;
  }

  /*
    splices point into route
  */
  insertRoutePointAt(latLng, index){
    this.routePolyline.getPath().insertAt(index,latLng)
    var marker = this.buildRouteMarker(latLng);
    this.bindToMapMarker(marker);
    this.routeMarkers.splice(index,0,marker);
    this.model.incrementRouteVertexIndecies(index);
    return marker;
  }

  insertPointOnEdge(latLng, points){
    /*
      Iterate through the point pairs on the segment
      determine which edge the latLng falls upon
      and insert a new point into route at the index of the edge point
    */
    var idx;

    var tolerance = this.getEdgeTolerance();
    for(var i = 1; i < points.length; i++ ){
      // does the event point fit in the bounds of the two reference points before and after the click
      var path = [points[i-1],points[i]];
      var line = new google.maps.Polyline({path: path});

      if(google.maps.geometry.poly.isLocationOnEdge(latLng, line, tolerance)) {
        idx = i;
        this.insertRoutePointAt(latLng, i);
        break; //we found it, we're done here
      }
      //we haven't found it, increse the tolerance and start over
      if(i == points.length - 1 ){
        tolerance = tolerance*2;
        i = 0;
      }
    }
    return idx;
  }

  /*
    calculates a tolerance for determining if a location falls on an edge based on map zoom level
  */
  getEdgeTolerance(){
    return Math.pow(this.map.getZoom(), -(this.map.getZoom()/5));
  }

  /*
    Adds a point to the route points array at the end, and makes the first waypoint if this is the first point on the route
  */
  addPointToRoute(latLng){
    var marker = this.pushRoutePoint(latLng)

    //if this is the first point on the route make it a waypoint
    if(this.routeMarkers.length == 1 && this.routePolyline.getPath().length == 1) {
      marker.kmFromStart = 0;
      marker.kmFromPrev = 0;
      // TODO how to refactor this? perhaps this should be two methods. It should also be part of the model
      marker.waypoint = app.roadbook.addWaypoint(this.addWaypoint(marker));
    }

    this.model.updateRoute();
  }

  /*
    Removes a point or waypoint from the route
  */
  deletePointFromRoute(marker){
    var pointIndex = marker.routePointIndex;
    this.deleteWaypointBubble(pointIndex);
    marker.setMap(null);
    //remove the point from our points array
    this.routePolyline.getPath().removeAt(pointIndex)
    //remove the marker from our markers array
    this.routeMarkers.splice(pointIndex,1);
    /*
      Decrement the pointIndex of each point on the route after the point being
      removed by one.
    */
    this.model.decrementRouteVertexIndecies(pointIndex);
  }

  /*
    Adds a waypoint to the route waypoints array in the proper spot with accurate distance measurements
    and notify the roadbook observer that there is a new waypoint to render

    Returns distance options so a new roadbook waypoint can be built from it.
    The reason we don't just do that here is that it allows the waypoint generation
    workflow to be more generalized
  */
  addWaypoint(marker) {
    //update the waypoint marker's icon
    marker.setIcon(this.buildWaypointIcon());
    // return point geoData so a roadbook waypoint can be created
    return this.model.getWaypointGeodata(marker);
  }
  /*
    Add a bubble to a marker
    NOTE not sure if this is exactly how we want to do things but we are in the crawl phase.
  */
  addWaypointBubble(routePointIndex,radius,fill) {
    var marker = this.routeMarkers[routePointIndex];
    var bubble = this.buildWaypointBubble(radius, marker.getPosition(), fill);
    marker.bubble = bubble;
  }

  /*
    determines which points to delete between the user defined delete points
  */
  clearPointDeleteQueue(deleteQueue, routeMarkers){
    deleteQueue.sort(function(a,b){return a - b});
    var start = deleteQueue[0];
    var end = deleteQueue[1];
    for(var i = end;i >= start;i--){
      if(routeMarkers[i].waypoint){
        this.deleteWaypoint(routeMarkers[i]);
      }
      this.deletePointFromRoute(routeMarkers[i]);
    }
  }

  deleteWaypoint(marker){
    this.model.deleteWaypoint(marker.waypoint.id);
    marker.setIcon(this.vertexIcon());
    this.deleteWaypointBubble(marker.routePointIndex);
    marker.waypoint = null;
  }

  deleteWaypointBubble(routePointIndex){
    if(this.routeMarkers[routePointIndex].bubble){
      this.routeMarkers[routePointIndex].bubble.setMap(null);
    }
  }

  returnPointToNaturalColor(marker){
    if(marker.waypoint){
      marker.setIcon(this.buildWaypointIcon());
    }else {
      marker.setIcon(this.buildVertexIcon());
    }
  }

  /*
    an icon which marks a normal point (vertex) on the route Polyline
  */
  buildVertexIcon(){
    return {
              path: 'M-1,-1 1,-1 1,1 -1,1z',
              scale: 7,
              strokeWeight: 2,
              strokeColor: '#ffba29',
              fillColor: '#787878',
              fillOpacity: 1
            };
  }

  /*
    an icon which marks a waypoint (vertex) on the route Polyline
  */
  buildWaypointIcon(){
    return {
              path: 'M-1.25,-1.25 1.25,-1.25 1.25,1.25 -1.25,1.25z',
              scale: 7,
              strokeWeight: 2,
              strokeColor: '#ff9000',
              fillColor: '#ff4200',
              fillOpacity: 1
            };
  }

  /*
    an icon which marks a waypoint (vertex) on the route Polyline
  */
  buildDeleteQueueIcon(){
    return {
              path: 'M-1.25,-1.25 1.25,-1.25 1.25,1.25 -1.25,1.25z',
              scale: 7,
              strokeWeight: 2,
              strokeColor: '#ff4200',
              fillColor: '#ff9000',
              fillOpacity: 1
            };
  }

  buildRouteMarker(latLng){
    return new google.maps.Marker({
                      icon: this.buildVertexIcon(),
                      map: this.map,
                      position: latLng,
                      draggable: true,
                      routePointIndex: this.routePolyline.getPath().length > 0 ? this.routePolyline.getPath().indexOf(latLng) : 0,
                    });
  }

  buildWaypointBubble(radius,center,fill){
    return new google.maps.Circle({
            strokeColor: fill,
            strokeOpacity: 0.5,
            strokeWeight: 2,
            fillColor: fill,
            fillOpacity: 0.2,
            clickable: false,
            map: this.map,
            center: center,
            radius: Number(radius)
          });
  }

  bindToModel(){
    this.model.markers = this.routeMarkers;
    this.model.route = this.routePolyline.getPath();
    this.model.presenter = this;
  }

  bindToMapSurface(){
    var _this = this;
    this.map.addListener('click', function(evt){
      if(_this.mapUnlocked && !app.pointDeleteMode){
        _this.addPointToRoute(evt.latLng);
      }
    });

    this.map.addListener('rightclick', function(evt){
      var autotrace = _this.dialog.showMessageBox({type: "question",
                                                   buttons: ["Cancel","Ok"],
                                                  defaultId: 1,
                                                  message: "About to auto-trace roads to your route, Are you sure?"});
      if(_this.mapUnlocked && !app.pointDeleteMode && (autotrace == 1)){
        if(_this.routePolyline.getPath().length >0){
          _this.model.getGoogleDirections(evt.latLng);
        }else {
          this.pushRoutePoint(latLng)
          this.updateRoute();
        }
      }
    });
  }

  bindToMapMarker(marker){
    var _this = this; //NOTE this will end up being some sort of abstraction of the map model

    /*
      When two items are in the queue, all points in between are deleted.
    */
    google.maps.event.addListener(marker, 'click', function(evt) {
      if(this.waypoint && !app.pointDeleteMode){
        // TODO make into waypoint function and abstract it from here
        $('#roadbook').scrollTop(0);
        $('#roadbook').scrollTop(($(this.waypoint.element).offset().top-100));
      }
    });

    /*
      right clicking on a route point adds it to delete queue.
    */
    google.maps.event.addListener(marker, 'rightclick', function(evt) {
      app.pointDeleteMode = true;
      if(_this.deleteQueue.length == 0){
        _this.deleteQueue.push(marker.routePointIndex);
        marker.setIcon(_this.buildDeleteQueueIcon());
      } else {
        _this.deleteQueue.push(marker.routePointIndex);
        _this.clearPointDeleteQueue(_this.deleteQueue, _this.routeMarkers);
        _this.model.updateRoute();
        _this.displayEdge = true; //we have to set this because the mouse out handler that usually handles this gets nuked in the delete
        _this.deleteQueue = [];
        app.pointDeleteMode = false
      }
    });

    /*
      double clicking on a route point toggles whether the point is a waypoint or not
    */
    google.maps.event.addListener(marker, 'dblclick', function(evt) {
      //If the point has a waypoint remove it, otherwise add one
      if(!app.pointDeleteMode){
        if(this.waypoint){
          _this.deleteWaypoint(this);
        } else {
          // TODO should route through model
          this.waypoint = app.roadbook.addWaypoint(_this.addWaypoint(this));
          $('#roadbook').scrollTop(0);
          $('#roadbook').scrollTop(($(this.waypoint.element).offset().top-100));
        }
        //recompute distances between waypoints
        _this.model.updateRoute();
      }
    });

    /*
      Dragging the point updates the latLng vertex position on the route Polyline
    */
    google.maps.event.addListener(marker, 'drag', function(evt) {
      _this.routePolyline.getPath().setAt(this.routePointIndex, evt.latLng);
      if(this.bubble){
        this.bubble.setCenter(evt.latLng);
      }
    });

    google.maps.event.addListener(marker, 'dragend', function(evt) {
      _this.model.updateRoute();
    });

    /*
      turns off display of the potential point marker on the route path so UI functions over a point are not impeeded.
    */
    google.maps.event.addListener(marker, 'mouseover', function(evt) {
      _this.displayEdge = false;
      if(app.pointDeleteMode){
        marker.setIcon(_this.buildDeleteQueueIcon())
      }
    });

    /*
      turns display of the potential point marker on the route path back on.
    */
    google.maps.event.addListener(marker, 'mouseout', function(evt) {
      _this.displayEdge = true;
      if(app.pointDeleteMode && (marker.routePointIndex != _this.deleteQueue[0])){
        _this.returnPointToNaturalColor(marker);
      }
    });
  }

  bindToMapPolyline(){
    var _this = this;
    /*
      hovering over the route between verticies will display a handle, which if clicked on will add a point to the route
    */
    google.maps.event.addListener(this.routePolyline, 'mouseover', function(evt){
      /*
        If we aren't over a point display a handle to add a new route point if the map is editable
      */
      if(_this.displayEdge && !app.pointDeleteMode){
        var dragging = false;
        var loc;
        var handle = new google.maps.Marker({
                                icon: _this.buildVertexIcon(),
                                map: this.map,
                                position: evt.latLng,
                                draggable: true,
                                zIndex: -1,
                              });
        google.maps.event.addListener(_this.routePolyline, 'mousemove', function(evt){
          if(_this.displayEdge && _this.mapUnlocked){
            handle.setPosition(evt.latLng);
          } else {
            handle.setMap(null);
          }
        });

        /*
          make the point go away if the mouse leaves the route, but not if it's being dragged
        */
        google.maps.event.addListener(_this.routePolyline, 'mouseout', function(evt){
          if(!dragging){
            handle.setMap(null);
          }
        });

        /*
          add the point to the route
        */
        google.maps.event.addListener(handle, 'mousedown', function(evt){
          dragging = true;
          var idx = _this.insertPointOnEdge(evt.latLng, _this.routePolyline.getPath().getArray());
          /*
            Add listeners to move the new route point and the route to the mouse drag position of the handle
          */
          google.maps.event.addListener(handle, 'drag', function(evt){
            if(idx !== undefined){ //in rare instances this can happen and causes the map to glitch out
              var point = _this.routeMarkers[idx];
              point.setPosition(evt.latLng);
              _this.routePolyline.getPath().setAt(point.routePointIndex, evt.latLng);
            }
          });

          /*
            get rid of the handle
          */
          google.maps.event.addListener(handle, 'mouseup', function(evt){
            dragging = false;
            _this.model.updateRoute();
            this.setMap(null);
          });
        });
      }
    });
  }

  bindToUI(){
    /*
        Nav Bar
    */
    var _this = this;
    $('#zin').click(function(){
      _this.zin();
      $(this).blur();
    });

    $('#zout').click(function(){
      _this.zout();
      $(this).blur();
    });

    $('#map-hybrid-layer').click(function(){
      _this.map.setMapTypeId(google.maps.MapTypeId.HYBRID);
      _this.updateLayerDropdown(this)
    });

    $('#map-satellite-layer').click(function(){
      _this.map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
      _this.updateLayerDropdown(this)
    });

    $('#map-roadmap-layer').click(function(){
      _this.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
      _this.updateLayerDropdown(this)
    });

    $('#map-terrain-layer').click(function(){
      _this.map.setMapTypeId(google.maps.MapTypeId.TERRAIN);
      _this.updateLayerDropdown(this)
    });

    $('#draw-route').click(function(){
      _this.toggleMapLock(this);
    });

    /*
        Waypoint Palette
    */
    $('#orient-map').click(function(){
      _this.orientMap();
    });

    $('#hide-palette').click(function(){
      _this.toggleMapLock();
      _this.reorient();
    });
  }
};