use std::cmp::Ordering;

#[derive(Clone, Debug)]
pub struct Post {
    pub title: &'static str,
    pub date: &'static str,
    pub slug: &'static str,
    pub excerpt: &'static str,
    pub author: &'static str,
    pub reading_time: &'static str,
    pub tags: &'static [&'static str],
    pub body: &'static str,
    pub ascii: &'static str,
}

const DOOMED_ASCII: &str = include_str!("../assets/blog/doomed.txt");
const LOGS_BODY: &str = include_str!("../assets/blog/the-logs.txt");

const POSTS: &[Post] = &[Post {
    title: "The Logs Don't Lie, But I Do",
    date: "2025-12-15",
    slug: "the-logs-dont-lie-but-i-do",
    excerpt: "Midnight thoughts about on-call duty dread, imposter syndrome, and the strange calm of lifting cold steel when the systems won't stay quiet.",
    author: "Stas Berg",
    reading_time: "7 min",
    tags: &["devops", "introspection", "burnout"],
    body: LOGS_BODY,
    ascii: DOOMED_ASCII,
}];

pub fn all_posts() -> Vec<Post> {
    let mut posts = POSTS.to_vec();
    posts.sort_by(|a, b| compare_dates(b.date, a.date));
    posts
}

pub fn get_post(slug: &str) -> Option<Post> {
    POSTS.iter().find(|post| post.slug == slug).cloned()
}

fn compare_dates(left: &str, right: &str) -> Ordering {
    let left = parse_date(left);
    let right = parse_date(right);
    right.cmp(&left)
}

fn parse_date(date: &str) -> (i32, i32, i32) {
    let parts: Vec<&str> = date.split('-').collect();
    let year = parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);
    let month = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
    let day = parts.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);
    (year, month, day)
}

pub fn format_date(date: &str) -> String {
    let (year, month, day) = parse_date(date);
    let month_label = match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        _ => "Dec",
    };
    format!("{month_label} {day:02}, {year}")
}

pub fn format_ls_date(date: &str) -> String {
    let (_, month, day) = parse_date(date);
    let month_label = match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        _ => "Dec",
    };
    format!("{month_label} {day:02}")
}
