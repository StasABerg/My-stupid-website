use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Serialize;

use super::Station;

const MAX_GENRES: usize = 200;

#[derive(Clone, Serialize, Default)]
pub struct ProcessedStations {
    pub station_count: usize,
    pub countries: Vec<String>,
    pub genres: Vec<String>,
    pub search_texts: Vec<String>,
    index_by_country: HashMap<String, Vec<usize>>,
    index_by_language: HashMap<String, Vec<usize>>,
    index_by_tag: HashMap<String, Vec<usize>>,
}

impl ProcessedStations {
    pub fn build(stations: &[Station]) -> Self {
        let mut countries_set: BTreeSet<String> = BTreeSet::new();
        let mut genre_counts: HashMap<String, GenreEntry> = HashMap::new();
        let mut index_by_country: HashMap<String, Vec<usize>> = HashMap::new();
        let mut index_by_language: HashMap<String, Vec<usize>> = HashMap::new();
        let mut index_by_tag: HashMap<String, Vec<usize>> = HashMap::new();
        let mut search_texts = Vec::with_capacity(stations.len());

        for (idx, station) in stations.iter().enumerate() {
            if let Some(country_name) = station.country.as_ref().and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }) {
                countries_set.insert(country_name.clone());
                if let Some(normalized) = normalize_token(&country_name) {
                    index_by_country.entry(normalized).or_default().push(idx);
                }
            }
            if let Some(code) = station.country_code.as_deref().and_then(normalize_token) {
                index_by_country.entry(code).or_default().push(idx);
            }

            for language in &station.languages {
                if let Some(normalized) = normalize_token(language.as_str()) {
                    index_by_language.entry(normalized).or_default().push(idx);
                }
            }

            for tag in &station.tags {
                if let Some(normalized) = normalize_token(tag.as_str()) {
                    index_by_tag
                        .entry(normalized.clone())
                        .or_default()
                        .push(idx);
                    let entry =
                        genre_counts
                            .entry(normalized.clone())
                            .or_insert_with(|| GenreEntry {
                                label: tag.trim().to_string(),
                                count: 0,
                            });
                    entry.count += 1;
                }
            }

            let mut search_parts = Vec::new();
            search_parts.push(station.name.to_lowercase());
            for tag in &station.tags {
                search_parts.push(tag.to_lowercase());
            }
            for language in &station.languages {
                search_parts.push(language.to_lowercase());
            }
            if let Some(country) = &station.country {
                search_parts.push(country.to_lowercase());
            }
            search_texts.push(search_parts.join(" "));
        }

        let mut genres: Vec<_> = genre_counts
            .into_iter()
            .map(|(_key, entry)| entry)
            .collect();
        genres.sort_unstable_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
        let genres = genres
            .into_iter()
            .map(|entry| entry.label)
            .take(MAX_GENRES)
            .collect();

        Self {
            station_count: stations.len(),
            countries: countries_set.into_iter().collect(),
            genres,
            search_texts,
            index_by_country,
            index_by_language,
            index_by_tag,
        }
    }

    pub fn indexes_for_country(&self, country: &str) -> Option<&[usize]> {
        self.index_by_country
            .get(&country.to_lowercase())
            .map(|list| list.as_slice())
    }

    pub fn indexes_for_language(&self, language: &str) -> Option<&[usize]> {
        self.index_by_language
            .get(&language.to_lowercase())
            .map(|list| list.as_slice())
    }

    pub fn indexes_for_tag(&self, tag: &str) -> Option<&[usize]> {
        self.index_by_tag
            .get(&tag.to_lowercase())
            .map(|list| list.as_slice())
    }

    pub fn search_matches(&self, search: &str, indexes: &mut Vec<usize>) {
        let needle = search.to_lowercase();
        indexes.retain(|idx| self.search_texts[*idx].contains(&needle));
    }
}

#[derive(Clone)]
struct GenreEntry {
    label: String,
    count: i32,
}

fn normalize_token(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_lowercase())
    }
}

pub fn intersect_lists(lists: &[Vec<usize>], station_count: usize) -> Vec<usize> {
    if lists.is_empty() {
        return (0..station_count).collect();
    }
    let mut ordered = lists.to_vec();
    ordered.sort_by_key(|list| list.len());
    let mut result = ordered[0].clone();
    for list in ordered.iter().skip(1) {
        let set: HashSet<usize> = list.iter().copied().collect();
        result.retain(|idx| set.contains(idx));
        if result.is_empty() {
            break;
        }
    }
    result
}
