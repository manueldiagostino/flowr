x <- 0
y <- 0
max_value <- 10
step <- 2

if (x == 0) {
  y <- 1
} else if (x < max_value) {
  y <- -1
}

while (x < max_value) {
  x <- x + step
  if (x == max_value) {
    y <- y * 2
  }
}
