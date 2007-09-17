dojo.provide("dojox.data.FlickrRestStore");

dojo.require("dojox.data.FlickrStore");

dojo.declare("dojox.data.FlickrRestStore",
	dojox.data.FlickrStore, {
	constructor: function(/*Object*/args){ 
		// summary:
		//	Initializer for the FlickrRestStore store.  
		// description:
		//	The FlickrRestStore is a Datastore interface to one of the basic services
		//	of the Flickr service, the public photo feed.  This does not provide
		//	access to all the services of Flickr.
		//	This store cannot do * and ? filtering as the flickr service 
		//	provides no interface for wildcards.
		if(args && args.label){
			if(args.label) {
				this.label = args.label;
			}
			if(args.apikey) {
				this._apikey = args.apikey;
			}
		}
		this._cache = [];
		this._prevRequests = {};
		this._handlers = {};
		this._prevRequestRanges = [];
		this._maxPhotosPerUser = {};
		this._id = dojox.data.FlickrRestStore.prototype._id++;
	},
	
	// _id: Integer
	// A unique identifier for this store.
	_id: 0,
	
	// _requestCount: Integer
	// A counter for the number of requests made. This is used to define
	// the callback function that Flickr will use.
	_requestCount: 0,
	
	// _flickrRestUrl: String
	//	The URL to the Flickr REST services.
	_flickrRestUrl: "http://www.flickr.com/services/rest/",
	
	// _apikey: String
	//	The users API key to be used when accessing Flickr REST services.
	_apikey: null,
	
	// _storeRef: String
	//	A key used to mark an data store item as belonging to this store.
	_storeRef: "_S",
	
	// _cache: Array
	//	An Array of all previously downloaded picture info.
	_cache: null,
	
	// _prevRequests: Object
	//	A HashMap used to record the signature of a request to prevent duplicate 
	//	request being made.
	_prevRequests: null,
	
	// _handlers: Object
	//	A HashMap used to record the handlers registered for a single remote request.  Multiple 
	//	requests may be made for the same information before the first request has finished. 
	//	Each element of this Object is an array of handlers to call back when the request finishes.
	//	This prevents multiple requests being made for the same information.  
	_handlers: null,
		
	_fetchItems: function(request, fetchHandler, errorHandler){
		// summary: Fetch flickr items that match to a query
		// request:
		//	A request object
		// fetchHandler:
		//	A function to call for fetched items
		// errorHandler:
		//	A function to call on error

		if(!request.query){
			request.query={};
		}
		
		var primaryKey = [];
		var secondaryKey = [];
		
		//Generate a unique function to be called back
		var callbackFn = "FlickrRestStoreCallback_" + this._id + "_" + (++this._requestCount);
		//Build up the content to send the request for.
		var content = {
			format: "json",
			method: "flickr.people.getPublicPhotos",
			api_key: this._apikey,
			jsoncallback: callbackFn
		};
		var isRest = false;
		if(request.query.userid){
			isRest = true;
			content.user_id = request.query.userid;
			primaryKey.push("userid"+request.query.userid);
		}
		if(request.query.apikey){
			isRest = true;
			content.api_key = request.query.apikey;
			secondaryKey.push("api"+request.query.apikey);
		}
		if(request.query.page){
			content.page = request.query.page;
			secondaryKey.push("page" + content.page);
		}else if(typeof(request.start) != "undefined" && request.start != null) {
			if(!request.count){
				request.count = 20;
			}
			var diff = request.start % request.count;
			var start = request.start, count = request.count;
			if(diff != 0) {
				if(start < count / 2) {
					count = start + count;
					start = 0; 
				} else {
					start = Math.ceil(count / 2);
					if(start != count / 2) {
						count = (count / 2) + 1;
					} else {
						count /= 2;
					}
				}
				request._realStart = request.start;
				request._realCount = request.count;
				request.start = start;
				request.count = count;
			} else {
				request._realStart = request._realCount = null;
			}
			
			content.page = (start / count) + 1;
			secondaryKey.push("page" + content.page);
		}
		if(request.count){
			content.per_page = request.count;
			secondaryKey.push("count" + request.count);
		}
		
		if(request.query.lang){
			content.lang = request.query.lang;
			secondaryKey.push("lang" + request.lang);
		}
		var url = this._flickrRestUrl;
		
		if(request.query.set){
		  content.method = "flickr.photosets.getPhotos";
		  content.photoset_id = request.query.set; 
		  requestKey.push("set" + request.query.set);
		}
		
		//Generate a unique key for this request, so the store can 
		//detect duplicate requests.
		primaryKey = primaryKey.join(".");
		secondaryKey = secondaryKey.length > 0 ? "." + secondaryKey.join(".") : "";
		var requestKey = primaryKey + secondaryKey;

		var thisHandler = {
	     		request: request,
	     		fetchHandler: fetchHandler,
	     		errorHandler: errorHandler
	   	};
	   	
	   	//If the request has already been made, but not yet completed,
	   	//then add the callback handler to the list of handlers
	   	//for this request, and finish.
	   	if(this._handlers[requestKey]){
	     		this._handlers[requestKey].push(thisHandler);
	     		return;
	   	}

  		this._handlers[requestKey] = [thisHandler];

  		//Linking this up to Flickr is a PAIN!
  		var self = this;
  		var handle = null;
  		var getArgs = {
			url: this._flickrRestUrl,
			preventCache: true,
			content: content
		};
		
  		var doHandle = function(processedData, data, handler){
			var onBegin = handler.request.onBegin;
			handler.request.onBegin = null;
			var maxPhotos;
			var req = handler.request;
			
			if(typeof(req._realStart) != undefined && req._realStart != null) {
				req.start = req._realStart;
				req.count = req._realCount;
				req._realStart = req._realCount = null;
			}

			//If the request contains an onBegin method, the total number
			//of photos must be calculated.
			if(onBegin){
				if(data && typeof(data.photos.perpage) != "undefined" && typeof(data.photos.pages) != "undefined"){
						if(data.photos.perpage * data.photos.pages <= handler.request.start + handler.request.count){
							//If the final page of results has been received, it is possible to 
							//know exactly how many photos there are
							maxPhotos = handler.request.start + data.photos.photo.length;                
						}else{
							//If the final page of results has not yet been received,
							//it is not possible to tell exactly how many photos exist, so
							//return the number of pages multiplied by the number of photos per page.
							maxPhotos = data.photos.perpage * data.photos.pages;
						}
						self._maxPhotosPerUser[primaryKey] = maxPhotos;
						onBegin(maxPhotos, handler.request);
				} else if(self._maxPhotosPerUser[primaryKey]) {
					onBegin(self._maxPhotosPerUser[primaryKey], handler.request);
				}
			}
			//Call whatever functions the caller has defined on the request object, except for onBegin
			handler.fetchHandler(processedData, handler.request);
			if(onBegin){
				//Replace the onBegin function, if it existed.
				handler.request.onBegin = onBegin;
			}
		};
		
		//Define a callback for the script that iterates through a list of 
		//handlers for this piece of data.  Multiple requests can come into
		//the store for the same data.
		var myHandler = function(data){
			//The handler should not be called more than once, so disconnect it.
			//if(handle !== null){ dojo.disconnect(handle); }
			if(data.stat != "ok"){
				errorHandler(null, request);
			}else{ //Process the items...
				var handlers = self._handlers[requestKey];
				if(!handlers){
					console.log("FlickrRestStore: no handlers for data", data);
					return;
				}

				self._handlers[requestKey] = null;
				self._prevRequests[requestKey] = data;

				//Process the data once.
				var processedData = self._processFlickrData(data, request, primaryKey);
				if(!self._prevRequestRanges[primaryKey]) {
					self._prevRequestRanges[primaryKey] = [];
				}
				self._prevRequestRanges[primaryKey].push({
					start: request.start,
					end: request.start + data.photos.photo.length
				});

				//Iterate through the array of handlers, calling each one.
				for(var i = 0; i < handlers.length; i++ ){
					doHandle(processedData, data, handlers[i]);
				}
			}
		};

		var data = this._prevRequests[requestKey];
		
		//If the data was previously retrieved, there is no need to fetch it again.
		if(data){
			this._handlers[requestKey] = null;
			doHandle(this._cache[primaryKey], data, thisHandler);
			return;
		} else if(this._checkPrevRanges(primaryKey, request.start, request.count)) {
			//If this range of data has already been retrieved, reuse it.
			this._handlers[requestKey] = null;
			doHandle(this._cache[primaryKey], null, thisHandler);
			return;
		}
		
		dojo.global[callbackFn] = function(data){
			myHandler(data);
			//Clean up the function, it should never be called again
			dojo.global[callbackFn] = null;
		};
				
		var deferred = dojo.io.script.get(getArgs);
		
		//We only set up the errback, because the callback isn't ever really used because we have
		//to link to the jsonFlickrFeed function....
		deferred.addErrback(function(error){
			dojo.disconnect(handle);
			errorHandler(error, request);
		});
	},
	
	getAttributes: function(item){
		//	summary: 
		//      See dojo.data.api.Read.getAttributes()
		return ["title", "author", "imageUrl", "imageUrlSmall", 
					"imageUrlMedium", "imageUrlThumb", "link"]; 
	},
	
	getValues: function(item, attribute){
		//	summary:
		//      See dojo.data.api.Read.getValue()
		this._assertIsItem(item);
		this._assertIsAttribute(attribute);
		if(attribute === "title"){
			return [this._unescapeHtml(item.title)]; // String
		}else if(attribute === "author"){
			return [item.owner]; // String
		}else if(attribute === "imageUrlSmall"){
			return [item.media.s]; // String
		}else if(attribute === "imageUrl"){
			return [item.media.l]; // String
		}else if(attribute === "imageUrlMedium"){
			return [item.media.m]; // String
		}else if(attribute === "imageUrlThumb"){
			return [item.media.t]; // String
		}else if(attribute === "link"){
			return ["http://www.flickr.com/photos/" + item.owner + "/" + item.id]; // String
		}
		return undefined;
	},

	_processFlickrData: function(/* Object */data, /* Object */request, /* String */ cacheKey){
		// summary: Processes the raw data from Flickr and updates the internal cache.
		// data: 
		//		Data returned from Flickr
		// request: 
		//		The original dojo.data.Request object passed in by the user.
		
		//If the data contains an 'item' object, it has not come from the REST services,
		//so process it using the FlickrStore.
		if(data.items){
			return dojox.data.FlickrStore.prototype._processFlickrData.apply(this,arguments);
		}

		var template = ["http://farm", null, ".static.flickr.com/", null, "/", null, "_", null];
		
		var items = [];
		if(data.stat == "ok" && data.photos && data.photos.photo){
			items = data.photos.photo;
			
			//Add on the store ref so that isItem can work.
			for(var i = 0; i < items.length; i++){
				var item = items[i];
				item[this._storeRef] = this;
				
				template[1] = item.farm;
				template[3] = item.server;
				template[5] = item.id;
				template[7] = item.secret;
				 
				var base = template.join("");
				item.media = {
					s: base + "_s.jpg",
				 	m: base + "_m.jpg",
				 	l: base + ".jpg",
				 	t: base + "_t.jpg"
				};
			}
		}
		var start = request.start ? request.start : 0;
		var arr = this._cache[cacheKey];
		if(!arr) {
			this._cache[cacheKey] = arr = [];
		}
		for(var count = 0; count < items.length; count++){
			arr[count + start] = items[count];
		}

		return arr; // Array
	},
	
	_checkPrevRanges: function(primaryKey, start, count) {
		var end = start + count;
		var arr = this._prevRequestRanges[primaryKey];
		if(!arr) {
			return false;
		}
		for(var i = 0; i< arr.length; i++) {
			if(start >= arr[i].start &&
			   end <= arr[i].end) {
				return true;
			}
		}
		return false;
	}
});

