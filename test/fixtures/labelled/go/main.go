package main

import "fmt"

func main() {
	s := NewStore()           // CALL go/main.go#main -> go/store.go#NewStore
	s.Add("a")                // CALL go/main.go#main -> go/store.go#Store.Add
	s.Add("b")                // CALL go/main.go#main -> go/store.go#Store.Add
	fmt.Println(Total(s.Items())) // CALL go/main.go#main -> go/total.go#Total, go/store.go#Store.Items
	var r Reader = s
	fmt.Println(r.Read()) // CALL go/main.go#main -> go/store.go#Store.Read
}
