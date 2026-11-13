use crate::images;

pub fn content_html(text: &str, images: &[Vec<u8>]) -> String {
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;");
    let mut html = format!("<div><p style=\"white-space:pre-wrap\">{escaped}</p>");
    for image in images {
        html.push_str(&format!(
            "<p><img src=\"{}\" alt=\"Attached image\"></p>",
            images::data_url(image)
        ));
    }
    html.push_str("</div>");
    html
}

// DIBV5: a top-down, 32-bit BGRA bitmap, with explicit masks and sRGB color space.
// Byte encoding avoids alignment-dependent casts and native struct layout assumptions.
#[cfg(any(test, all(windows, feature = "desktop")))]
fn dib_v5(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut bytes = vec![0; 124];
    for (offset, value) in [
        (0, 124),
        (4, width),
        (8, (-(height as i32)) as u32),
        (16, 3),
        (20, rgba.len() as u32),
        (40, 0x00ff0000),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
        (56, 0x73524742),
        (108, 4),
    ] {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes[12..14].copy_from_slice(&1_u16.to_le_bytes());
    bytes[14..16].copy_from_slice(&32_u16.to_le_bytes());
    bytes.reserve(rgba.len());
    for pixel in rgba.chunks_exact(4) {
        bytes.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }
    bytes
}

#[cfg(all(windows, feature = "desktop"))]
pub fn write_mixed(text: &str, images: &[Vec<u8>]) -> Result<(), String> {
    use clipboard_win::{options::NoClear, raw, Clipboard};
    let first = images.first().ok_or("No image to copy.")?;
    let (width, height, rgba) = images::decode_rgba(first)?;
    let bitmap = dib_v5(width, height, &rgba);
    let html = content_html(text, images);
    let png_format = raw::register_format("PNG")
        .ok_or("Could not register the image clipboard format.")?
        .get();
    let html_format = raw::register_format("HTML Format")
        .ok_or("Could not register the rich clipboard format.")?
        .get();
    let result = (|| {
        let _clipboard = Clipboard::new_attempts(10)?;
        raw::empty()?;
        raw::set_html(html_format, &html)?;
        raw::set_without_clear(png_format, first)?;
        raw::set_without_clear(clipboard_win::formats::CF_DIBV5, &bitmap)?;
        raw::set_string_with(text, NoClear)
    })();
    result.map_err(|_| "Could not copy text and images. Try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rich_clipboard_keeps_images_and_escapes_literal_text() {
        let png = images::encode_rgba(1, 1, &[1, 2, 3, 4]).unwrap();
        let html = content_html("<script> & \"quote\"\nnext", &[png.clone(), png]);
        assert!(html.contains("&lt;script&gt; &amp; &quot;quote&quot;\nnext"));
        assert!(!html.contains("<script>"));
        assert_eq!(html.matches("<img ").count(), 2);
        let dib = dib_v5(1, 1, &[1, 2, 3, 4]);
        assert_eq!(i32::from_le_bytes(dib[8..12].try_into().unwrap()), -1);
        assert_eq!(&dib[124..], &[3, 2, 1, 4]);
        assert_eq!(u32::from_le_bytes(dib[..4].try_into().unwrap()), 124);
    }
}
