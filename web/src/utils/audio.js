/**
 * Audio playback utilities
 */

/**
 * Play audio from base64 data (supports PCM16 and MP3)
 * @param {string} audioBase64 - Base64 encoded audio data
 * @param {string} mimeType - MIME type (e.g., 'audio/pcm;rate=24000' or 'audio/mpeg')
 */
export async function playAudioData(audioBase64, mimeType) {
  try {
    // Decode base64 to binary
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Check if it's PCM audio (from Realtime API)
    if (mimeType && mimeType.includes('pcm')) {
      // PCM16 at 24kHz - need to convert to Float32 for WebAudio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });

      // Convert PCM16 (Int16) to Float32
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Create AudioBuffer and play
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } else {
      // MP3 or other format - use Audio element
      const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    }
  } catch (error) {
    console.error('Error playing audio:', error);
  }
}
