#[cfg(target_arch = "wasm32")]
pub fn ls_date_now() -> String {
    let date = js_sys::Date::new_0();
    let month = match date.get_month() {
        0 => "Jan",
        1 => "Feb",
        2 => "Mar",
        3 => "Apr",
        4 => "May",
        5 => "Jun",
        6 => "Jul",
        7 => "Aug",
        8 => "Sep",
        9 => "Oct",
        10 => "Nov",
        _ => "Dec",
    };
    let day = date.get_date();
    format!("{month} {day:02}")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn ls_date_now() -> String {
    "Dec 20".to_string()
}
