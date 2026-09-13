-- Reorder the default preset's categories into the order `category-presets.ts`
-- now declares: consumables and shopping, then housing and daily services, then
-- transport, health, growth and subscriptions, then leisure and social giving.
--
-- Scope is the thirteen names the preset owns, in both locales, and live rows
-- only. A category the ledger renamed, deleted, or added keeps its own
-- `sort_order`, so a custom value can tie with a new preset value; the read
-- order (`sort_order`, `created_at`, `id`) resolves that deterministically.
-- Extras are deliberately not pushed after the preset block — that is what
-- adopting a preset does, and it would move rows this migration was not asked
-- about.
--
-- Values are 1-based, matching how a new ledger's rows are seeded. Only the
-- relative order matters, so a ledger whose rows happen to be 0-based is
-- unaffected beyond a uniform shift.

UPDATE "entry_categories" AS category
SET "sort_order" = preset."sort_order",
    "updated_at" = now()
FROM (
  VALUES
    ('餐饮', 1),
    ('Dining', 1),
    ('日用', 2),
    ('Household', 2),
    ('购物', 3),
    ('Shopping', 3),
    ('服饰', 4),
    ('Clothing', 4),
    ('个护', 5),
    ('Personal Care', 5),
    ('住房', 6),
    ('Housing', 6),
    ('生活', 7),
    ('Daily Life', 7),
    ('交通', 8),
    ('Transport', 8),
    ('医疗', 9),
    ('Healthcare', 9),
    ('教育', 10),
    ('Education', 10),
    ('会员', 11),
    ('Memberships', 11),
    ('娱乐', 12),
    ('Entertainment', 12),
    ('人情', 13),
    ('Gifts & Giving', 13)
) AS preset("name", "sort_order")
WHERE category."name" = preset."name"
  AND category."deleted_at" IS NULL;
