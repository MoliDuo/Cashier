-- The account no longer has a preference to store.
--
-- `preferences` held one key, `interfaceLanguage`, which chose between the
-- Chinese and English UI. The English UI is gone, so the column holds a
-- setting with one possible value.
ALTER TABLE "users" DROP COLUMN "preferences";