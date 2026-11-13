use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

pub const MAX_IMAGES: usize = 8;
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 16 * 1024 * 1024;
const PREFIX: &str = "data:image/png;base64,";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRef {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageData {
    pub id: String,
    pub data_url: String,
}

pub struct PreparedImage {
    pub png: Vec<u8>,
    pub thumbnail: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Images can contain at most 16 megapixels.".into());
    }
    Ok(())
}

pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    check_dimensions(width, height)?;
    if rgba.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return Err("The clipboard image is incomplete.".into());
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| "Could not encode the image.")?;
        writer
            .write_image_data(rgba)
            .map_err(|_| "Could not encode the image.")?;
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Images must be no larger than 8 MiB as PNG.".into());
    }
    Ok(bytes)
}

pub fn decode_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Images must be no larger than 8 MiB as PNG.".into());
    }
    let mut decoder = png::Decoder::new_with_limits(
        Cursor::new(bytes),
        png::Limits {
            bytes: 80 * 1024 * 1024,
        },
    );
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let header = decoder
        .read_header_info()
        .map_err(|_| "This image is not a valid PNG.")?;
    check_dimensions(header.width, header.height)?;
    let mut reader = decoder
        .read_info()
        .map_err(|_| "This image is not a valid PNG.")?;
    if reader.info().animation_control.is_some() {
        return Err("Paste a still image instead of an animated PNG.".into());
    }
    let size = reader
        .output_buffer_size()
        .ok_or("Image dimensions are too large.")?;
    if size > (MAX_PIXELS * 4) as usize {
        return Err("Image dimensions are too large.".into());
    }
    let mut pixels = vec![0; size];
    let info = reader
        .next_frame(&mut pixels)
        .map_err(|_| "This image is incomplete or damaged.")?;
    reader
        .finish()
        .map_err(|_| "This image is incomplete or damaged.")?;
    pixels.truncate(info.buffer_size());
    if info.color_type == png::ColorType::Rgba {
        return Ok((info.width, info.height, pixels));
    }
    let mut rgba = Vec::with_capacity(info.width as usize * info.height as usize * 4);
    match info.color_type {
        png::ColorType::Rgba => unreachable!(),
        png::ColorType::Rgb => {
            for pixel in pixels.as_chunks::<3>().0 {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        png::ColorType::Grayscale => {
            for pixel in &pixels {
                rgba.extend_from_slice(&[*pixel, *pixel, *pixel, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in pixels.as_chunks::<2>().0 {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
            }
        }
        png::ColorType::Indexed => return Err("Could not decode this image.".into()),
    }
    Ok((info.width, info.height, rgba))
}

pub fn prepare(png: Vec<u8>) -> Result<PreparedImage, String> {
    let (width, height, rgba) = decode_rgba(&png)?;
    let thumbnail = thumbnail(width, height, &rgba)?;
    Ok(PreparedImage {
        png,
        thumbnail,
        width,
        height,
    })
}

pub fn prepare_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<PreparedImage, String> {
    let png = encode_rgba(width, height, rgba)?;
    let thumbnail = thumbnail(width, height, rgba)?;
    Ok(PreparedImage {
        png,
        thumbnail,
        width,
        height,
    })
}

fn thumbnail(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let scale = (512.0 / f64::from(width))
        .min(320.0 / f64::from(height))
        .min(1.0);
    let tw = (f64::from(width) * scale).round().max(1.0) as u32;
    let th = (f64::from(height) * scale).round().max(1.0) as u32;
    let mut thumb = Vec::with_capacity(tw as usize * th as usize * 4);
    for y in 0..th {
        for x in 0..tw {
            let sx = u64::from(x) * u64::from(width) / u64::from(tw);
            let sy = u64::from(y) * u64::from(height) / u64::from(th);
            let index = ((sy * u64::from(width) + sx) * 4) as usize;
            thumb.extend_from_slice(&rgba[index..index + 4]);
        }
    }
    encode_rgba(tw, th, &thumb)
}

pub fn from_data_url(data: &str) -> Result<PreparedImage, String> {
    let data = data.strip_prefix(PREFIX).ok_or("Paste a PNG image.")?;
    if data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err("Images must be no larger than 8 MiB as PNG.".into());
    }
    prepare(
        STANDARD
            .decode(data)
            .map_err(|_| "This image is not valid base64.")?,
    )
}

pub fn data_url(bytes: &[u8]) -> String {
    format!("{PREFIX}{}", STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn png_preserves_transparency_and_builds_a_small_preview() {
        let rgba = [20, 40, 60, 100].repeat(800 * 600);
        let png = encode_rgba(800, 600, &rgba).unwrap();
        let image = from_data_url(&data_url(&png)).unwrap();
        assert_eq!(decode_rgba(&image.png).unwrap(), (800, 600, rgba));
        let (w, h, _) = decode_rgba(&image.thumbnail).unwrap();
        assert!(w <= 512 && h <= 320);
        assert!(from_data_url("data:image/svg+xml;base64,AAAA").is_err());
        assert!(from_data_url("data:image/png;base64,AAAA").is_err());
        assert!(decode_rgba(&png[..png.len() / 2]).is_err());
        assert!(check_dimensions(50_000, 50_000).is_err());
    }
}
