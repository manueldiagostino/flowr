outer_counter <- 0
inner_counter <- -5
threshold <- -10
step <- 2
limit <- 5

while (outer_counter < limit) {
  inner_counter <- -5
  while (inner_counter < 5) {
    if (inner_counter <= threshold || (inner_counter <= 0 && (outer_counter %% 2 == 1))) {
      inner_counter <- inner_counter + step
    } else if (inner_counter > 0 && (outer_counter %% 2 == 0)) {
      inner_counter <- inner_counter - step
    } else {
      inner_counter <- inner_counter + 1
    }
  }
  outer_counter <- outer_counter + 1
}
