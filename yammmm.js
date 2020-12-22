Module.register("yammmm", {

    // Default module config
    defaults: {
        //sound
        sampleRate: 48000,
        frameSize: 1920,
        //maximumFrequency = sampleRate / 2
        fftSize: 1024, //should never need to touch this!
        
        //visualization
        scalingFactor: 60,
        dampingFactor: 4.0,
        minPlottedFrequency: 100,
        maxPlottedFrequency: 5000,
        canvasWidth: 800,
        canvasHeight: 600,
        
        //processing
        smoothingConstant: 0.6  ,

        binCount: 80,
        binMinSize: 5
    },

    // Override dom generator
    getDom: function() {
        var wrapper = document.createElement("div");
        wrapper.innerText = "Hello world";
        var canvas = document.createElement("canvas");
        canvas.width = this.config.canvasWidth;
        canvas.height = this.config.canvasHeight;
        this.canvas = canvas;
        this.canvasContext = canvas.getContext("2d");
        wrapper.appendChild(canvas);
        console.log("Got module dom: yammmm")
        return wrapper;

    },

    sliceFrequencyIndices: function(arrayLength, startFrequency, endFrequency) {
        let sliceStart = Math.floor((arrayLength - 1) * startFrequency / this.maximumFrequency);
        let sliceEnd = Math.floor((arrayLength - 1) * endFrequency / this.maximumFrequency);
        let sliceLength = 1 + sliceEnd - sliceStart;
        return [sliceStart, sliceEnd, sliceLength];
    },

    // Override start method
    start: function() {
        console.log("Starting module: " + this.name);
        this.maximumFrequency = this.config.sampleRate / 2;

        this.offset = undefined;
        this.rawData = undefined;
        this.fillerArray - new Uint8Array(256).fill(0); //will be appended to the sample to create a power-of-two length
        this.magnitudes = undefined; //stores the batch of fft data currently being rendered
        this.newMagnitudes = undefined; //stores the most recent batch of fft data
        this.oldMagnitudes = undefined;
        this.newSignal = false;
        [this.sliceStart, this.sliceEnd, this.sliceLength] = this.sliceFrequencyIndices(
            this.config.fftSize, 
            this.config.minPlottedFrequency,
            this.config.maxPlottedFrequency
            );
        
        this.coords = this.gammaCoordinates();
        [this.binMap, this.edgeMap] = this.minSizeBinning(this.coords, this.config.binMinSize);
        
        //Send a notification 
        this.sendSocketNotification('YAMMMM_READY', {sampleRate: this.config.sampleRate, frameSize: this.config.frameSize});
    },


    /**
     * Transforms the evenly-spaced frequencies of the fft into an approximately logarithmic horizontal scale more reflective of human perception
     * 
     * @param {*} gamma variable representing the degree of "stretch" applied to the spectrum 
     * 
     * @return {Array} frequencyCoordinates, the scaled horizontal positions of every frequency in canvas coordinates
     */
    gammaCoordinates: function(gamma = 1.2){
        let frequencyCoordinates = new Array(this.sliceLength);
        
        for (let i = 0; i < this.sliceLength; i++){
            frequencyCoordinates[i] = (this.config.canvasWidth * (i / this.sliceLength) ** (1 / gamma))
        }   
        return frequencyCoordinates;
    },

    /**
     * 
     * @param {*} frequencyCoordinates An array containing the scaled horizontal position of the frequency at each index, 
     *                                 as output by a ___Coordinates() function
     * @param {*} minWidth The minumum width, in pixels, of each bin
     * 
     * @return {Array} frequencyBinMap an array containing the number of the bin each frequency will ultimately be plotted under
     * @return {Array} binEdgeMap an array containing the horizontal coordinate of the leading edge of each bin 
     */
    minSizeBinning: function(frequencyCoordinates, minWidth = 5){ //minWidth including 1-px space?
    
        let frequencyBinMap = new Array(frequencyCoordinates.length).fill(-1); //an entry of -1 indicates that a frequency will not be graphed

        let binEdgeMap = new Array(1).fill(0);
            for (let frequencyId = this.sliceStart; frequencyId < this.sliceEnd + 1; frequencyId++){
                let nextFreqEdge = Math.round(frequencyCoordinates[frequencyId - this.sliceStart]);
                let binWidth = nextFreqEdge - binEdgeMap[binEdgeMap.length - 1]; //distance between leading edge of current bin and leading edge of last bin
                frequencyBinMap[frequencyId] = binEdgeMap.length; //mark this frequency as being for the current bin
                if (binWidth >= minWidth){
                    binEdgeMap.push(nextFreqEdge);
                } //otherwise, we just "extend" this bin to include the next frequency (done in the next iteration)
            }
            return [frequencyBinMap, binEdgeMap];
    },

     /**
     *  todo: currently nonfunctional
     * @param {*} frequencyCoordinates An array containing the scaled horizontal position of the frequency at each index, 
     *                                 as output by a ___Coordinates() function
     * @param {*} desiredBins The number of  equally-sized bins to sort frequencies into
     * 
     * @return {Array} frequencyBinMap an array containing the number of the bin each frequency will ultimately be plotted under
     * @return {Array} binEdgeMap an array containing the horizontal coordinate of the leading edge of each bin 
     */
    equalSizeBinning: function(frequencyCoordinates, desiredBins= 100){
        let frequencyBinMap = new Array(frequencyCoordinates.length).fill(-1); //an entry of -1 indicates that a frequency will not be graphd
        let binEdgeMap = new Array(desiredBins);
        let width = Math.floor(this.config.canvasWidth / desiredBins);
        for (let i = 0; i < binEdgeMap.length; i++){
            binEdgeMap[i] = i * width;
        }

        for (let frequencyId = this.sliceStart; frequencyId < this.sliceEnd + 1; frequencyId++){
            frequencyBinMap[frequencyId] = Math.ceil(frequencyCoordinates[frequencyId] / width); //== Math.floor() + 1, == Math.floor() while ignoring bin 0 for consistency 
            //                                                                   with minSizeBinning's outputs
        }
        //console.log(frequencyBinMap)
        return [frequencyBinMap, binEdgeMap];
    },

    /**
     * 
     * @param {*} frequencyData An array of the magnitudes of each frequency as calculated by fast fourier transform
     * @param {*} frequencyBinMap frequencyBinMap, an array containing the number of the bin each frequency will ultimately 
     *                            be plotted under, as output by a  ___Binning()
     * @return {Array} binHeights, an array of the maximum magnitude of the members of each bin. 
     *                 This determines the heights of the final drawn bars.
     */
    calculateBinHeights: function(frequencyData, frequencyBinMap){
        let binHeights = new Array(frequencyBinMap[frequencyBinMap.length - 1] + 1).fill(0);
        for (let i = 0; i < frequencyData.length; i++){ // ignore frequencies outside the range
            if (frequencyBinMap[i] == -1){
                continue;
            }
            if (frequencyData[i] > binHeights[frequencyBinMap[i]]){
                binHeights[frequencyBinMap[i]] = frequencyData[i];
            }
        }
        return binHeights
    },

    smoothing: function(magnitudes, oldMagnitudes, smoothRatio) { // todo refactor
        for (let i = 0; i < magnitudes.length; i++) {
            magnitudes[i] = (oldMagnitudes[i] * smoothRatio) + (magnitudes[i] * (1 - smoothRatio));
        }
    },

    draw: function () {

        requestAnimationFrame(() => this.draw());
        this.lastDrawnMagnitudes = this.magnitudes
        this.oldTime = this.time;
        this.time = performance.now();

        if (this.oldTime !== undefined){
            //console.log((this.time - this.oldTime))
        }

        if (this.newSignal){
            this.magnitudes = this.newMagnitudes //todo refactor to local variable
            this.newSignal = false;
        }
        if (this.magnitudes === undefined || this.lastDrawnMagnitudes === undefined){
            return;
        }
        this.smoothing(this.magnitudes, this.lastDrawnMagnitudes, this.config.smoothingConstant);


        let binHeights = this.calculateBinHeights(this.magnitudes, this.binMap);

        this.canvasContext.fillStyle = 'rgb(0,0,0)';
        this.canvasContext.fillRect(0, 0, this.canvas.width, this.canvas.height);

        let oldEdge;
        let edge = 0;
        for (let i = 0; i < this.edgeMap.length; i++){
            oldEdge = edge;
            edge = this.edgeMap[i + 1];
            let barHeight = (Math.log(binHeights[i]) - this.config.dampingFactor) * this.config.scalingFactor;
            let barWidth = edge - oldEdge - 1;
            this.canvasContext.fillStyle = 'rgb(100,100,100)';
            this.canvasContext.fillRect(oldEdge + i, this.canvas.height - barHeight, barWidth, barHeight);
        }
        //console.log(performance.now() - this.time);
    },

    notificationReceived: function(notification, payload, sender) {
        if (notification === "MODULE_DOM_CREATED"){
            console.log(" dom finished, requesting magnitudes")
            this.draw();
        }
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "YAMMMM_UPDATE_MAGNITUDES"){
            this.newSignal = true;
            this.newMagnitudes = payload.mag;
        }
    }
});