const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;

export function imageFileType(file: File): string | undefined {
  if (file.type) return ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'].includes(file.type) ? file.type : undefined;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',gif:'image/gif'} as Record<string,string>)[extension ?? ''];
}

export async function clipboardImage(file: File): Promise<string> {
  const type = imageFileType(file);
  if (!type) throw new Error('Use PNG, JPEG, WebP, BMP, or GIF image files.');
  if (file.size > MAX_BYTES) throw new Error('Images must be no larger than 8 MiB.');
  // PNG clipboard payloads can go directly to Rust for bounded validation.
  if (type === 'image/png') return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the pasted image.'));
    reader.readAsDataURL(file);
  });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error('Images can contain at most 16 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read the pasted image.');
    context.drawImage(image, 0, 0);
    const data = canvas.toDataURL('image/png');
    if (data.length > Math.ceil(MAX_BYTES / 3) * 4 + 22) throw new Error('Images must be no larger than 8 MiB as PNG.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}
