/**
 * AudioWorklet processor for converting audio to PCM16 format
 * This runs in the audio worklet thread (separate from main thread)
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // If no input, continue processing
    if (!input || !input[0]) {
      return true;
    }

    const inputData = input[0]; // First channel (mono)

    // Convert Float32 to Int16 PCM
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Send PCM16 data to main thread
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true; // Keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
