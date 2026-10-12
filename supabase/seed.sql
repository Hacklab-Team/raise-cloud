-- Store catalog (real Indian EAN barcodes; prices are this demo store's own price list).
insert into public.products (barcode, title, brand, price, image_url) values
    ('8901058023800', 'Maggi 2-Minute Masala Noodles (8 × 70 g)', 'Maggi', 112, 'https://images.openfoodfacts.org/images/products/890/105/802/3800/front_en.3.200.jpg'),
    ('8901491503020', 'Lay''s India''s Magic Masala (26.5 g)', 'Lay''s', 10, 'https://images.openfoodfacts.org/images/products/890/149/150/3020/front_en.35.200.jpg'),
    ('8901719123870', 'Parle-G Original Glucose Biscuits (250 g)', 'Parle', 25, 'https://images.openfoodfacts.org/images/products/890/171/912/3870/front_en.27.200.jpg'),
    ('8901262010016', 'Amul Pasteurised Butter (100 g)', 'Amul', 58, 'https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.53.200.jpg'),
    ('8901764042911', 'Thums Up Soft Drink (250 ml)', 'Thums Up', 20, 'https://images.openfoodfacts.org/images/products/890/176/404/2911/front_en.41.200.jpg'),
    ('8901030877124', 'Brooke Bond Red Label Tea', 'Brooke Bond', 145, 'https://images.openfoodfacts.org/images/products/890/103/087/7124/front_en.3.200.jpg'),
    ('89009949', 'Nescafé Classic Instant Coffee (45 g)', 'Nescafé', 175, 'https://images.openfoodfacts.org/images/products/000/008/900/9949/front_en.4.200.jpg'),
    ('8901030865169', 'Surf Excel Detergent Bar (250 g)', 'Surf Excel', 38, 'https://images.openfoodfacts.org/images/products/890/103/086/5169/front_en.9.200.jpg'),
    ('7622202271861', 'Cadbury Dairy Milk Silk Bubbly (46 g)', 'Cadbury', 95, 'https://images.openfoodfacts.org/images/products/762/220/227/1861/front_en.9.200.jpg'),
    ('8901063371255', 'Britannia Marie Gold (68.9 g)', 'Britannia', 10, 'https://raise.bindalvansh01.workers.dev/img/8901063371255.jpg'),
    ('8904063258366', 'Lay''s American Style Cream & Onion (52.9 g)', 'Lay''s', 20, 'https://raise.bindalvansh01.workers.dev/img/8901491100250.jpg'),
    ('8902080104581', 'Pepsi (400 ml)', 'Pepsi', 20, 'https://raise.bindalvansh01.workers.dev/img/8902080104581.jpg'),
    ('8902080364589', 'Mountain Dew (400 ml)', 'Mountain Dew', 20, 'https://raise.bindalvansh01.workers.dev/img/8902080364589.jpg'),
    ('7622202836596', 'Cadbury Oreo Golden Vanilla Creme Biscuits', 'Oreo', 10, 'https://raise.bindalvansh01.workers.dev/img/oreo-golden.jpg'),
    ('8901030804939', 'Dove Hair Care (650 ml)', 'Dove', 499, 'https://images.openfoodfacts.org/images/products/890/103/080/4939/front_en.4.200.jpg')
on conflict (barcode) do nothing;
