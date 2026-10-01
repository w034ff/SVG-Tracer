use std::collections::{HashMap, HashSet};

use tracer::resolve_output_names;

#[test]
fn test_no_collision() {
    let inputs = vec![
        "cat.png".to_string(),
        "dog.jpg".to_string(),
        "fish.webp".to_string(),
    ];
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["cat.svg", "dog.svg", "fish.svg"]);
}

#[test]
fn test_collision_with_existing_files() {
    let inputs = vec!["cat.png".to_string(), "dog.jpg".to_string()];
    let mut existing = HashSet::new();
    existing.insert("cat.svg".to_string());

    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["cat (1).svg", "dog.svg"]);
}

#[test]
fn test_collision_between_inputs() {
    // "logo.jpg" < "logo.png" in Unicode code point order ('j' < 'p').
    // Therefore, "logo.jpg" gets "logo.svg" and "logo.png" gets "logo (1).svg".
    let inputs = vec!["logo.png".to_string(), "logo.jpg".to_string()];
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["logo (1).svg", "logo.svg"]);

    let inputs_reversed = vec!["logo.jpg".to_string(), "logo.png".to_string()];
    let outputs_reversed = resolve_output_names(&inputs_reversed, &existing);
    assert_eq!(outputs_reversed, vec!["logo.svg", "logo (1).svg"]);
}

#[test]
fn test_sequential_increment_with_existing_numbered_files() {
    let inputs = vec!["logo.png".to_string()];
    let mut existing = HashSet::new();
    existing.insert("logo.svg".to_string());
    existing.insert("logo (1).svg".to_string());

    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["logo (2).svg"]);
}

#[test]
fn test_case_insensitive_collision() {
    // Unicode code point order: 'L' (0x4C) < 'l' (0x6C).
    // 1. "Logo.png" is evaluated first:
    //    "Logo.svg" collides with existing "LOGO.svg" (case-insensitive).
    //    Next candidate "Logo (1).svg" succeeds.
    // 2. "logo.jpg" is evaluated second:
    //    "logo.svg" collides with existing "LOGO.svg".
    //    "logo (1).svg" collides with assigned "Logo (1).svg".
    //    Next candidate "logo (2).svg" succeeds.
    let inputs = vec!["Logo.png".to_string(), "logo.jpg".to_string()];
    let mut existing = HashSet::new();
    existing.insert("LOGO.svg".to_string());

    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["Logo (1).svg", "logo (2).svg"]);
}

#[test]
fn test_multiple_extensions() {
    let inputs = vec!["a.b.png".to_string(), "archive.tar.gz".to_string()];
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["a.b.svg", "archive.tar.svg"]);

    let mut existing_with_ab = HashSet::new();
    existing_with_ab.insert("a.b.svg".to_string());
    let outputs_with_collision = resolve_output_names(&inputs, &existing_with_ab);
    assert_eq!(
        outputs_with_collision,
        vec!["a.b (1).svg", "archive.tar.svg"]
    );
}

#[test]
fn test_order_independence_of_result_mapping() {
    // The assignment of names must be deterministic regardless of the order
    // in which inputs are provided. We verify this by checking that the mapping
    // from each input to its assigned output remains identical across permutations.
    let original_inputs = vec![
        "photo.png".to_string(),
        "logo.png".to_string(),
        "logo.jpg".to_string(),
        "Logo.webp".to_string(),
        "icon.bmp".to_string(),
    ];
    let mut existing = HashSet::new();
    existing.insert("logo.svg".to_string());

    // Canonical mapping computed from the original order
    let canonical_outputs = resolve_output_names(&original_inputs, &existing);
    let canonical_map: HashMap<&String, &String> = original_inputs
        .iter()
        .zip(canonical_outputs.iter())
        .collect();

    // Permutation 1: Reversed
    let mut perm1 = original_inputs.clone();
    perm1.reverse();
    let outputs1 = resolve_output_names(&perm1, &existing);
    let map1: HashMap<&String, &String> = perm1.iter().zip(outputs1.iter()).collect();
    assert_eq!(
        map1, canonical_map,
        "Reversed permutation produced different mapping"
    );

    // Permutation 2: Rotated
    let mut perm2 = original_inputs.clone();
    perm2.rotate_left(2);
    let outputs2 = resolve_output_names(&perm2, &existing);
    let map2: HashMap<&String, &String> = perm2.iter().zip(outputs2.iter()).collect();
    assert_eq!(
        map2, canonical_map,
        "Rotated permutation produced different mapping"
    );

    // Permutation 3: Sorted
    let mut perm3 = original_inputs.clone();
    perm3.sort();
    let outputs3 = resolve_output_names(&perm3, &existing);
    let map3: HashMap<&String, &String> = perm3.iter().zip(outputs3.iter()).collect();
    assert_eq!(
        map3, canonical_map,
        "Sorted permutation produced different mapping"
    );
}

#[test]
fn test_empty_inputs() {
    let inputs: Vec<String> = Vec::new();
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert!(outputs.is_empty());
}

#[test]
fn test_duplicate_inputs() {
    let inputs = vec!["image.png".to_string(), "image.png".to_string()];
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["image.svg", "image (1).svg"]);
}

#[test]
fn test_no_extension() {
    let inputs = vec!["README".to_string()];
    let existing = HashSet::new();
    let outputs = resolve_output_names(&inputs, &existing);
    assert_eq!(outputs, vec!["README.svg"]);
}
