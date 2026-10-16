package main

type Reader interface{ Read() string }

func Total(xs []string) int {
	n := 0
	for _, x := range xs {
		n += len(x)
	}
	return n
}
