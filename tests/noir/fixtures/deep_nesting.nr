fn deeply_nested(x: u32) {
    if x > 0 {
        if x > 10 {
            if x > 100 {
                assert(false);
            }
        }
    }
}
