export class UadeVisualizationSource {
  constructor(tracer) {
    this._tracer = tracer;
  }

  get streamCount() {
    return this._tracer.getNumStreams();
  }

  get sampleLength() {
    return this._tracer.getDataLength();
  }

  getZoom() {
    return this._tracer.getZoomLevel();
  }

  setZoom(level) {
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new RangeError("Visualization zoom must be an integer from 1 to 5.");
    }
    this._tracer.setZoom(level);
  }

  readChannel(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.streamCount) {
      throw new RangeError("Visualization channel is outside the available stream range.");
    }
    return this._tracer.getData(channel);
  }

  readVu(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.streamCount) {
      throw new RangeError("Visualization channel is outside the available stream range.");
    }
    return this._tracer.getVuMeterLevel(channel);
  }

  readOverallVu() {
    return this._tracer.getOverallVuMeterLevel();
  }
}