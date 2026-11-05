-- Change the default currency for new transactions only.
-- Existing amounts, balances, records and migration history are preserved.
ALTER TABLE "financial_transactions" ALTER COLUMN "currency" SET DEFAULT 'SLE';
