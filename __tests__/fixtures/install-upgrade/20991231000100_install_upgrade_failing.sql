-- Test fixture: a migration that fails (division by zero), for the forced upgrade failure in scripts/install-e2e.sh.
SELECT 1 / 0;
