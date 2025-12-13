use chrono::Utc;
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use radio_service_rs::stations::{Station, StationsPayload};
use std::hint::black_box;

fn create_test_payload(count: usize) -> StationsPayload {
    let stations: Vec<Station> = (0..count)
        .map(|i| Station {
            id: format!("station-{}", i),
            name: format!("Test Station {}", i),
            stream_url: format!("https://example.com/stream-{}.mp3", i),
            homepage: Some(format!("https://example.com/station-{}", i)),
            favicon: Some(format!("https://example.com/favicon-{}.png", i)),
            country: Some("United States".to_string()),
            country_code: Some("US".to_string()),
            state: Some("California".to_string()),
            languages: vec!["English".to_string()],
            tags: vec!["rock".to_string(), "music".to_string(), "radio".to_string()],
            coordinates: None,
            bitrate: Some(128),
            codec: Some("MP3".to_string()),
            hls: false,
            is_online: true,
            last_checked_at: Some(Utc::now().to_rfc3339()),
            last_changed_at: Some(Utc::now().to_rfc3339()),
            click_count: 42,
            click_trend: 1,
            votes: 100,
        })
        .collect();

    StationsPayload {
        schema_version: Some(1),
        updated_at: Utc::now(),
        source: Some("radio-browser".to_string()),
        requests: vec!["https://example.com".to_string()],
        total: count,
        stations,
        fingerprint: Some("test-fingerprint".to_string()),
    }
}

fn encode_json(payload: &StationsPayload) -> Vec<u8> {
    serde_json::to_vec(payload).unwrap()
}

fn decode_json(data: &[u8]) -> StationsPayload {
    serde_json::from_slice(data).unwrap()
}

fn encode_msgpack_lz4(payload: &StationsPayload) -> Vec<u8> {
    let msgpack = rmp_serde::to_vec(payload).unwrap();
    lz4_flex::compress_prepend_size(&msgpack)
}

fn decode_msgpack_lz4(data: &[u8]) -> StationsPayload {
    let decompressed = lz4_flex::decompress_size_prepended(data).unwrap();
    rmp_serde::from_slice(&decompressed).unwrap()
}

fn bench_serialization(c: &mut Criterion) {
    let sizes = vec![100, 1000, 5000];
    let mut group = c.benchmark_group("serialization");

    for size in sizes {
        let payload = create_test_payload(size);

        group.bench_with_input(BenchmarkId::new("json", size), &payload, |b, p| {
            b.iter(|| encode_json(black_box(p)))
        });

        group.bench_with_input(BenchmarkId::new("msgpack+lz4", size), &payload, |b, p| {
            b.iter(|| encode_msgpack_lz4(black_box(p)))
        });
    }
    group.finish();
}

fn bench_deserialization(c: &mut Criterion) {
    let sizes = vec![100, 1000, 5000];
    let mut group = c.benchmark_group("deserialization");

    for size in sizes {
        let payload = create_test_payload(size);
        let json_data = encode_json(&payload);
        let msgpack_data = encode_msgpack_lz4(&payload);

        group.bench_with_input(BenchmarkId::new("json", size), &json_data, |b, data| {
            b.iter(|| decode_json(black_box(data)))
        });

        group.bench_with_input(
            BenchmarkId::new("msgpack+lz4", size),
            &msgpack_data,
            |b, data| b.iter(|| decode_msgpack_lz4(black_box(data))),
        );
    }
    group.finish();
}

fn bench_roundtrip(c: &mut Criterion) {
    let sizes = vec![100, 1000, 5000];
    let mut group = c.benchmark_group("roundtrip");

    for size in sizes {
        let payload = create_test_payload(size);

        group.bench_with_input(BenchmarkId::new("json", size), &payload, |b, p| {
            b.iter(|| {
                let encoded = encode_json(black_box(p));
                decode_json(&encoded)
            })
        });

        group.bench_with_input(BenchmarkId::new("msgpack+lz4", size), &payload, |b, p| {
            b.iter(|| {
                let encoded = encode_msgpack_lz4(black_box(p));
                decode_msgpack_lz4(&encoded)
            })
        });
    }
    group.finish();
}

fn bench_size_comparison(c: &mut Criterion) {
    let sizes = vec![100, 1000, 5000, 10000];
    let mut group = c.benchmark_group("size_comparison");

    for size in sizes {
        let payload = create_test_payload(size);
        let json_size = encode_json(&payload).len();
        let msgpack_size = encode_msgpack_lz4(&payload).len();
        let compression_ratio = (1.0 - (msgpack_size as f64 / json_size as f64)) * 100.0;

        println!(
            "\n[{}] JSON: {} bytes, MessagePack+LZ4: {} bytes, Compression: {:.1}%",
            size, json_size, msgpack_size, compression_ratio
        );

        // Dummy benchmark to show in results
        group.bench_function(format!("comparison_{}", size), |b| b.iter(|| {}));
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_serialization,
    bench_deserialization,
    bench_roundtrip,
    bench_size_comparison
);
criterion_main!(benches);
