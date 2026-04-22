fn deeply_nested(x: i32) {
    if x > 0 {
        if x > 10 {
            if x > 100 {
                println!("very large");
            }
        }
    }
}
