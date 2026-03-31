package main

func deeplyNested(x int) {
	if x > 0 {
		if x > 10 {
			if x > 100 {
				println("very large")
			}
		}
	}
}
