-- Disposable databases only: drops price announcements and their answers (export them first).
-- Lines and reservations with status 'returned' remain; the previous application shows them as their raw status.
DROP TABLE "part_price_notices";
