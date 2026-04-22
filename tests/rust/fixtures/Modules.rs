mod math {
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}

fn main() {
    let result = math::add(1, 2);
}
