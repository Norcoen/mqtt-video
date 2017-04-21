#!/usr/bin/env python
"""
Listen for video requests
"""

import paho.mqtt.client as mqtt
import paho.mqtt.publish
import subprocess
import shlex
import threading
import os
import select
import json
import traceback
import sys

    
    


class VideoRelay( threading.Thread ):

    
    def IFrameCount( self, vbuffer ):
        proc = subprocess.Popen(["ffprobe","-show_frames","pipe:0"],\
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        proc.stdin.write(vbuffer)
        proc.stdin.flush()
        (stdout,stderrdata) = proc.communicate()
        if type(stdout) == type(""):
            return stdout.count("pict_type=I")
        return 0 



    def __init__(self, url, client, topic):
        threading.Thread.__init__(self)
        self.daemon = True
        self.url = url
        self.client = client
        self.topic = topic
        self.vpr, self.vpw = os.pipe()
        self.cmd_r, self.cmd_w = os.pipe()
        self.plist  = select.poll()
        self.plist.register(self.cmd_r, select.POLLIN)
        self.plist.register(self.vpr,select.POLLIN)
        self.running = True 

        
    def stop(self):
        os.write('x',self.cmd_w)

    def run(self):
        cmdfmt = \
           "ffmpeg -nostdin -y -loglevel -8 -i %(url)s "+\
           " -vf scale=320:240 -c:v libx264 -x264-params  keyint=30:no-scenecut "+\
           "  -profile:v baseline -level 3.0  -b 192k "+\
           " -movflags empty_moov+default_base_moof+frag_keyframe "+\
           " -f mp4 pipe:%(vpw)d  "


        cmd = cmdfmt % vars(self)
        print "Executing: ",cmd

        self.proc = subprocess.Popen(shlex.split(cmd))
        vbuffer = ""

        while self.running:
            for (fd,evt) in self.plist.poll(5000):
                print fd, evt 
                  
                if (fd == self.cmd_r) and (evt & select.POLLIN):
                    x = os.read(self.cmd_r,1)
                    self.running = False
                elif (fd == self.vpr) and (evt & select.POLLIN):
                    chunk = os.read(self.vpr,1000000)

                    print "read ",len(chunk), "bytes"

                    vbuffer += chunk
                    # Wait until we have 2 complete frames 
                    if vbuffer.count('moof') < 2:
                        continue 


                    chunk = vbuffer
                    vbuffer = ""
                            
                    n = self.client.publish(self.topic,payload=bytearray(chunk))
                    print( "sending ", len(chunk), " bytes to ",self.topic )  

        print "existing feed thread"

        
Videos = {}        
  
     

# The callback for when the client receives a CONNACK response from the server.
def on_connect(client, userdata, flags, rc):
    client.subscribe("client/#")
def on_message(client, userdata, msg):
    try:
        _on_message(client, userdata, msg)
    except:
        print traceback.format_exc()

# The callback for when a PUBLISH message is received from the server.
def _on_message(client, userdata, msg):
    print(msg.topic+" "+str(msg.payload))
    print(type(msg.topic))
    """
    self.TOPICS = {
        UNREGISTER: "client/unregister",
        REGISTER: "client/register",
        DESCRIBE: "client/describe",
        PLAY: "client/play" 
    }; 

    """
                     
    if msg.topic == "client/describe":
         


        req = json.loads(msg.payload.decode()) 
        reply = {
            "mimeCodec": 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
            "error":"" 
        }
        print "sending reply", req['resp_topic'] 
        client.publish(req['resp_topic'], payload=json.dumps(reply))

    elif msg.topic == "client/play": 
        req = json.loads(msg.payload.decode())   
        url = req['url'] 

        Videos[url] = VideoRelay(url, client, req['resp_topic'])
        Videos[url].start()


client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect("localhost", 1883, 60)

# Blocking call that processes network traffic, dispatches callbacks and
# handles reconnecting.
# Other loop*() functions are available that give a threaded interface and a
# manual interface.
client.loop_forever()

