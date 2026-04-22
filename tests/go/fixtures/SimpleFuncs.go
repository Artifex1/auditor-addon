package main

func a() {
	b()
}

func b() {
	c()
}

func c() {}

func Helper() int {
	return 42
}
