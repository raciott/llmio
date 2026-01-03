mkdb:
	mkdir -p db

tidy:
	go mod tidy

fmt:
	go fmt ./...

run:
	go run .

add: fmt tidy
	git add .

.PHONY: webui

webui: 
	cd webui && npm install && npm run build