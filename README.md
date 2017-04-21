# mqtt-video
Demonstrate streaming video using MQTT/websockets to a javascript client using the MediaSource API's


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





