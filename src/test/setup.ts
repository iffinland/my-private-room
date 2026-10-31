/**
 * jsdom's Blob/File predate the `arrayBuffer()` helper used by the app's
 * base64 staging path. Browsers and Node 18+ provide it natively, so this is a
 * test-environment shim only.
 */
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('Blob could not be read as an ArrayBuffer.'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Blob read failed.'));
      reader.readAsArrayBuffer(this);
    });
  };
}
