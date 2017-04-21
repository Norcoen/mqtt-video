/**

Demonstrating the ability to play H264 video generated from a server
live in a browser using the MediaSource API using websockets. 

For transport I am using the MQTT message broker that is normally for
used for publishing and subscribing to text messages. However it has
a web socket interface for javascript so a javascript client can bypass
a web server and talk directly to a server running on the back end.

For this demo the javascript client will send a URL to a server
which will transcode the video to H264 then publish it to the requesting
web client via web sockets. The MP4 fraemented video data will then be routed 
directly to video HTML element using the Media Source API.

For security reasons the server will only allow this SAFE URL to be played:

rtsp://mpv.cdn3.bigCDN.com:554/bigCDN/definst/mp4:bigbuckbunnyiphone_400.mp4

To run on the server you will need the mosquitto MQTT daemon installed 
on your machine. 

Installation:

   The installation that used invloves setting up MQTT for websockets. 

1.
   Get the mosquitto MQTT daemon, this is what is acting as a websocket
router using a publisher/subscriber interface.

   // On debian/Ubuntu
   >> apt-get install mosquitto 

   // for others:
   https://mosquitto.org/download/

   Add these lines to the bottom of the /etc/mosquitto/mosquitto.conf file

      # Activate websocket interface to the mosquitto message broker 
      listener 9001 0.0.0.0
      protocol websockets

   Restart mosquitto to pick up the changes
   >> sudo service mosquitto restart

2.
   
   In order for web sockets to work you need to have COORS support turned on. You can 
   either allow COORS globally in the browser 

      For chrome: goto chrome://flags and search for 'cross-origin' 

   Or preferably in your web server that you are using to load the client. 
    
3.

   Install the python mqtt client for the video server:

   // On debian/Ubuntu
   apt-get install python-pip
   pip install paho-mqtt

4. 

   Run the media server:

   cd mqtt-video/server && chmod +x ./server.py && ./server.py

5.

   For the client you can use any webserver. There is a one liner
   web server that is included:

   cd mqtt-video/client && chmod +x ./one-line-http.sh && ./one-line-http.sh
   // http://<webserver address>:8000 should be available.


--------------------------------------------------------------------------------------------

Protocol (along the lines of RTSP):

  web client               MQTT Broker                           MediaServer
  ==========               ============                          ===========

 [start button click] ---> topic: video/describe            ----> validate client      
                            message: {
                                url: ".."
                                reply_topic: "client/describe/response"
                            }

  Setup MediaSource       <--- topic: client/describe/response <-- This is mime you will have to play   
  test mimeCodec           message {
                                mimeCodec: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
                                
                            }                              

  We can play this mime --> topic: video/play  {                    --> start playing
                                url: ".."
                                reply_topic: "video_<random digits>"
                            }  

                                                         
  MediaSource API         topic: video_<random digits>    <-------- ffmpeg will connect/transcode/buffer at
                           binary MP4 data                          least 2 I frames then send.
                                                                    
                          
                           
*/


function _publish(topic, msg){
    // route datastructure 'msg' to mqtt topic 
    var message = new Paho.MQTT.Message(JSON.stringify(msg));
    message.destinationName = topic;
    MQTTClient.send(message);
}

function _register_cb(self, topic, cb){
    console.log("registering callback for " + topic ); 
    self.mqtt_handlers[topic] = cb;
    MQTTClient.subscribe(topic);
}

function _unregister_cb(self, topic) {
    delete self.mqtt_handlers[topic];
    MQTTClient.unsubscribe(topic);
}

function _dequeue_chunk(self) {
    if (self.sourceBuffer.updating === true) {
        console.log("dequeue timer: source buffer still updating");
        return; 
    }  

    if ( self.vq.length > 0 ) {
        // process video after other events processed.
        var chunk = self.vq.splice(0,1)[0];
        if (typeof chunk !== 'undefined' ) {
            console.log("dequeue timer qs = "+parseInt(self.vq.length)+" running, sending " + parseInt(chunk.length) + " bytes.");  
            self.sourceBuffer.appendBuffer(chunk);
        }
    }
}

// route responses to source buffer for decoding.
function _enqueue_chunk(self, message) { 
     
    console.log("_enqueue_chunk: self.sourceBuffer.updating = " + self.sourceBuffer.updating );     

    if (self.sourceBuffer.updating === true) {
         
        // still processing buffer, push message
        if (self.vq.length < self.MAX_VQ_LENGTH) { 
            
            self.vq.push( message.payloadBytes );
        } else {
            self.handler({
                error: "Queue depth exceeded dropping video",
                errno: self.VIDEO_QUEUE_DEPTH_EXCEEDED
            }); 
        }
    } else {
        // append to video buffer
        console.log("appending " + message.payloadBytes.length + " bytes");
        self.sourceBuffer.appendBuffer( message.payloadBytes );
    }


    // stop dequeue timer if not needed 
    if ( (self.vq.length == 0) &&  (self.dequeue_timer !== null) )
    {
        console.log("disable dequeue timer");
        clearInterval(self.dequeue_timer);
        self.dequeue_timer = null; 
    }
    else if ( (self.vq.length > 0) &&  (self.dequeue_timer === null) )
    {
        // we don't know the frame rate but we have to move fast
        console.log("enable dequeue timer");
        self.dequeue_timer = setInterval(_dequeue_chunk, 50, self);
    }
                                
    return true;
}

/**
   Play video by routing MP4 to the video element
*/
function _play( self, mimeCodec ) {
    var video_q = [];

    self.mediaSource = new MediaSource();
    self.video.src = URL.createObjectURL(mediaSource);
    self.mediaSource.addEventListener('sourceopen', function(){
        // after opening the src attach a buffer 
        self.sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
        self.sourceBuffer.mode = "sequence";
        

        console.log("sourceBuffer ");
        console.log(self.sourceBuffer);
        self.sourceBuffer.addEventListener('updateend',function(){
            console.log("updateend: video.paused = " + self.video.paused);
            console.log(self.mediaSource.readyState);

            if ( self.mediaSource.readyState === "ended" ) {
                mediaSource.endOfStream();
                console.log("fatal error");
                return; 
            }

            // buffer next chunk
            if ( video_q.length > 1 ) {
                var chunk = video_q[0];
                console.log("appending video from q");
                try {
                    //var duration = self.mediaSource.duration;
                    //self.sourceBuffer.timestampOffset = duration;
                    self.sourceBuffer.appendBuffer( chunk );
                    video_q.splice(0,1)[0];
                }catch(e){
                    console.log("error appending to source buffer");
                }                  
            }

            if ( self.video.paused === true ) {
                try {
                    self.video.play();
                    console.log("video set to playing");   
                } catch(e){
                    console.log("video.play failed " + e.message);
                }
            }
        }, false); // end updateend handler
    }, false); // end source open

    // alert remote service to start playing stream
    var video_topic = "video_" + parseInt(Math.random() * 1000000000);
    _register_cb(self, video_topic, function( self, message ) {
        if ( self.sourceBuffer.updating === false ) {
            console.log("appending video from ws");
            self.sourceBuffer.appendBuffer( message.payloadBytes );
                
        } else {
            console.log("q video from web socket"); 
            video_q.push(  message.payloadBytes );
        }
        return true; // serve next chunk of video. 
    });  
  
    // tell server to play video
    _publish(self.TOPICS.PLAY,{
        clientId: self.clientId,
        url: self.url,
        resp_topic: video_topic 
    });

        
    self.mediaSource.addEventListener('sourceended', function() {
        //We should alert server to stop playing, or perhaps restart  
        console.log('MediaSource readyState: ' + this.readyState);
    }, false);
} 


/**
   Describe then play video
*/
function _onDescribe(self, message){
    var jobj = JSON.parse(message.payloadString);
    var mimeCodec = jobj['mimeCodec'];

    // determine if mime type is allowed.
    if ('MediaSource' in window && MediaSource.isTypeSupported(mimeCodec)) { 

        // mime supported start playing vide     
        _play( self, mimeCodec );

    } else {

        self.handler({
             error: "MediaSource unable to play " + self.url + " mimeCodec= " + mimeCodec,
             errno: self.CODEC_NOT_SUPPORTED 
        });
    }

    return false; // remove after single use.
}

/**
   Inbound MQTT message or video data.
*/
function _onMqttMessage(self, message){
    // inbound mqtt message handler
    var topic = message.destinationName;
    // get redgistered callback for topic
    var func = self.mqtt_handlers[topic];
    if ( typeof func !== 'undefined' ) {
        // execute callback,
        var persist = func( self, message );
        // if persist is not true then delete 
        if ( !persist ) {
            _unregister_cb(self, topic);
        }
    }      
}

/**
    Connected to the MQTT deamon
*/
function _onMqttConnected(self){

    // register this client with the server so we can shutdown
    // feeds when the client exits    
    _publish(self.TOPICS.REGISTER, {clientId: self.clientId});

    $('#stop').click(function(){
        _publish(self.TOPICS.STOP, {
            url: self.url
        }); 
        _unregister_cb(self, self.TOPICS.PLAY); 
        if ( self.sourceBuffer !== null ) {       
            self.sourceBuffer.abort();
        }
        $('#v1').attr('poster','');
    });

    // assign callback for start button
    $('#start').click(function(){ 
        $('#v1').attr('poster','loading.gif');
        self.url = $('#url').val();

        var resp_topic = "client/describe/response_" + parseInt(Math.random() * 1000000000);
        // handle response to describe
       
        // handle the server reply 
        _register_cb(self, resp_topic, _onDescribe);
       
        // ask media server to describe the mime type for this
        // url.
        _publish(self.TOPICS.DESCRIBE, {
            clientId: self.clientId,
            url: self.url,
            resp_topic: resp_topic   
        });

    });
    
} 

/**
   Setup MQTT client if not defined
*/
function _wv_mqtt_setup(self){
   // MQTTClient is a singleton  
   if (typeof MQTTClient === "undefined") { 
                        
        var wsbroker = window.location.hostname;  // mqtt websocket enabled broker
        var wsport = 9001                         // port for above
        self.clientId = "id_" + parseInt(Math.random());

        // required to be a global variable according to the docs!  
        MQTTClient = new Paho.MQTT.Client(wsbroker, wsport, clientId);

        MQTTClient.onConnectionLost = function (responseObject) {
            console.log(responseObject);
            self.handler({
                error: "web socket failure",
                errnum: self.WEBSOCKET_FAILURE
            });
        };

        MQTTClient.onMessageArrived = function (message) {
            _onMqttMessage( self, message );
        };


        // setup connection options
        var options = {
            timeout: 3,
            onSuccess: function () {
                _onMqttConnected(self);   
            },
            onFailure: function (message) {
                self.handler({
                    error: "web socket failure",
                    errnum: self.WEBSOCKET_FAILURE
                });
            }
        };
        // last will message sent on disconnect        
        var willmsg = new Paho.MQTT.Message(JSON.stringify({
            clientId: self.clientId
        }));
        willmsg.qos = 2;
        willmsg.destinationName = self.TOPICS.UNREGISTER;
        willmsg.retained = true;
        options.willMessage = willmsg;
        MQTTClient.connect(options);
    }
}

// get video element and url we are to play.
function _wv_setup(self, eid){
    /* find the element and extract attributes from tag 
       and setup media source, return false if uncessfull in 
       doing so.
    */
    self.video = document.getElementById( eid );
    if (!self.video) {
        self.handler({
           error  : 'Unable to find element id="'+eid+'"',
           errnum : self.MISSING_ID,
        });
        return false;    
    }

    self.url = video.getAttribute("data-url");
    if (!self.url) {
        self.handler({
            error : 'Missing data-url',
            errnum: self.MISSING_ATTR 
        });
        return false;
    }    

}

/* 
    Perform all actions to stream live video. 

    The user supplies the id of of the video tag (ident)
    and an event handler (handler). The handler function
    is given a dictionary

    function handler({
       error  : non zero length strng in case of error,
       errnum : numeric code associated with error or 0 for no error
       status : text contianing status information
    });

*/
function mqtt_video( eid, handler ) {
    var self = this;

    // assign event handler
    self.handler = handler;
    self.dequeue_timer = null;

    self.vq = []; // video chunk queue
    self.mqtt_handlers = {};
    self.stats = {
        count: 0
    };
    self.sourceBuffer = null;   
    self.MAX_VQ_LENGTH = 60;
   
    // error numbers
    self.NOERROR = 0;
    self.MISSING_ATTR = -1;
    self.MISSING_ID = -2;
    self.WEBSOCKET_FAILURE = -3;
    self.CODEC_NOT_SUPPORTED = -4;
    self.VIDEO_QUEUE_DEPTH_EXCEEDED = -5;
   
    self.TOPICS = {
        UNREGISTER: "client/unregister",
        REGISTER: "client/register",
        DESCRIBE: "client/describe",
        PLAY: "client/play",
        STOP: "client/stop" 
    }; 
    // setup mqtt if not already done.
    _wv_mqtt_setup( self );
        
    // process html tag
    _wv_setup(self, eid);

    return self;     
}
  
