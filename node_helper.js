const { RtAudio, RtAudioFormat, RtAudioStreamFlags } = require('audify');
const ft = require('fourier-transform');
const wndw = require('fft-windowing');
const {performance} = require('perf_hooks')
var NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
    start: function() {
        this.socketEstablished = false;
        this.rtAudio = new RtAudio();
        this.filler = new Uint8Array(256).fill(0);
        this.rawData = undefined;

    },

    socketNotificationReceived: function(notification, payload){
        //console.log("received signal!")
        if (notification === "YAMMMM_READY"){
            console.log("received ready signal!")
            if (this.socketEstablished == false){
                this.rtAudio.openStream(
                    null,
                    {
                        deviceID: this.rtAudio.getDefaultInputDevice(),
                        nChannels: 1, //currently only takes in the left channel
                        firstChannel: 0
                    },
                    RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
                    payload.sampleRate, // default 48khz (HiFiBerry DIGI+)
                    payload.frameSize, // default 1920 (HiFiBerry DIGI+)
                    "yammmm", // Device/stream name for JACK and PulseAudio
                    (pcm) => {
                        let real = Buffer.concat([pcm, this.filler]); //total length 4096 bytes, but it's 16-bit audio so this represents 2048 samples
                        real = new Uint16Array(real.buffer, real.byteOffset, real.byteLength / Uint16Array.BYTES_PER_ELEMENT) //total length 2048
                        let mags = ft(wndw.blackman(real, 0.16)); //total length 1024
                        
                        this.sendSocketNotification("YAMMMM_UPDATE_MAGNITUDES", {mag: mags, time: performance.now()}); 
                     },
                    null,
                    (RtAudioStreamFlags.RTAUDIO_SCHEDULE_REALTIME + RtAudioStreamFlags.RTAUDIO_MINIMIZE_LATENCY)
                    );
                this.rtAudio.start();
            }
            this.socketEstablished = true;
        } else if (notification === "YAMMMM_REQUEST_MAGNITUDES" && this.rawData !== undefined){
            //console.log("received request for magnitudes!")
        
        }
    }
});