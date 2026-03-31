pub struct Counter {
    value: i32,
}

impl Counter {
    pub fn new() -> Self {
        Counter { value: 0 }
    }

    pub fn increment(&mut self) {
        self.value += 1;
    }

    pub fn get(&self) -> i32 {
        self.value
    }

    fn reset(&mut self) {
        self.value = 0;
    }
}
