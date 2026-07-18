
x = input()
total = 0
c = 0
for x in str:
  if x>="0" and x<="9":
      total = total + int(x)
  elif (x>="A" and x<="Z") or (x>="a" and x<="z"):
      c = c+1
    
code = total%c


print(f"SUM = {total}, COUNT = {c}")
print(f"CODE = {code}")
  