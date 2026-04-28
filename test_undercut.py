import math

def undercut_price(p):
    if p <= 0:
        return 0
    length = math.floor(math.log10(p)) + 1
    undercut_unit = 10**max(0, length - 4)
    return p - undercut_unit

test_cases = [
    (1555000, 1554000),
    (1000, 999),
    (100, 99),
    (15550, 15540),
    (411200, 411100),
    (1.5, 0.5), # length=1. length-4=-3. max(0,-3)=0. 10^0=1. 1.5-1=0.5
    (0.5, -0.5), # length=0. length-4=-4. max(0,-4)=0. 10^0=1. 0.5-1=-0.5
]

for p, expected in test_cases:
    result = undercut_price(p)
    print(f"Price: {p:10} | Result: {result:10} | Expected: {expected:10} | {'PASS' if result == expected else 'FAIL'}")
