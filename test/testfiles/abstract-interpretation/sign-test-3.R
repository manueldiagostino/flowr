outer_counter <- 1
inner_counter <- 1
threshold <- -5
step <- 1
limit <- 10

while (outer_counter <= limit && true) {
  
  inner_counter <- 1
  
  while (inner_counter <= threshold) {
    
    if (inner_counter == threshold) {
        a <- 10
    } else if (inner_counter < threshold / 2) {
        b <- -10
    }
    
    inner_counter <- inner_counter + step
  }
  
  outer_counter <- outer_counter + step
}
