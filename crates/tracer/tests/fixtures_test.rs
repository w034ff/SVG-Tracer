use std::path::PathBuf;

#[test]
fn test_all_fixtures_exist_and_valid() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixtures_dir = manifest_dir.join("tests").join("fixtures");

    let required_files = [
        "logo_color.png",
        "logo_small_transparency.png",
        "icon_mono.png",
        "icon_mono_transparent.png",
        "logo_color.jpg",
        "logo_color.bmp",
        "logo_color.webp",
        "logo_color.gif",
        "anim.gif",
        "corrupt.png",
        "not_image.png",
    ];

    for file_name in &required_files {
        let path = fixtures_dir.join(file_name);
        assert!(
            path.exists(),
            "Required fixture does not exist: {}",
            path.display()
        );
        let metadata = std::fs::metadata(&path).expect("Failed to read metadata");
        assert!(metadata.len() > 0, "Fixture is empty: {}", file_name);
    }

    // Verify dimensions of primary image fixtures
    let logo_color =
        image::open(fixtures_dir.join("logo_color.png")).expect("Failed to open logo_color.png");
    assert_eq!(logo_color.width(), 1024);
    assert_eq!(logo_color.height(), 1024);

    let logo_small_trans = image::open(fixtures_dir.join("logo_small_transparency.png"))
        .expect("Failed to open logo_small_transparency.png");
    assert_eq!(logo_small_trans.width(), 512);
    assert_eq!(logo_small_trans.height(), 512);

    let icon_mono =
        image::open(fixtures_dir.join("icon_mono.png")).expect("Failed to open icon_mono.png");
    assert_eq!(icon_mono.width(), 256);
    assert_eq!(icon_mono.height(), 256);

    let icon_mono_trans = image::open(fixtures_dir.join("icon_mono_transparent.png"))
        .expect("Failed to open icon_mono_transparent.png");
    assert_eq!(icon_mono_trans.width(), 256);
    assert_eq!(icon_mono_trans.height(), 256);

    let anim_gif = image::open(fixtures_dir.join("anim.gif")).expect("Failed to open anim.gif");
    assert_eq!(anim_gif.width(), 128);
    assert_eq!(anim_gif.height(), 128);

    // Verify corrupt.png has PNG signature
    let corrupt_bytes =
        std::fs::read(fixtures_dir.join("corrupt.png")).expect("Failed to read corrupt.png");
    assert_eq!(
        &corrupt_bytes[0..8],
        &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    );

    // Verify not_image.png is plain text
    let not_image_bytes =
        std::fs::read(fixtures_dir.join("not_image.png")).expect("Failed to read not_image.png");
    assert!(std::str::from_utf8(&not_image_bytes).is_ok());
}
