# Inventory reorder

A daily reorder check built only from UserTasks features: a **schedule** trigger, the **Stock items** and **Reorders** data tables, a **loop** with a condition, a **sub-workflow** per item (**call_sub_workflow**), task forms with **Approve order / Skip** and **Counts confirmed / Recount needed** buttons, reminders and a purchase-order email template.

## After installing

1. Load your stock into **Stock items**. The check compares `on_hand` with `reorder_point` for every row with **Active** ticked.
2. Set the default of **Buyer (user id)** on **Daily stock check** (empty = the person who installed it).
3. Adjust the trigger (07:00 daily, Pacific/Auckland) and configure email so suppliers receive purchase orders.

## How it works

- **Daily stock check** (schedule) lists active items, then for each item where `on_hand <= reorder_point` and **On order** is not ticked it calls **Raise reorder**. Data-table list filters compare a column with a fixed value, so the column-to-column comparison is done by a Condition inside the loop.
- **Raise reorder** (sub-workflow) ticks **On order**, logs a `awaiting approval` row in **Reorders** and gives the buyer **Approve the reorder**. **Approve order** records the quantity, cost and expected date (today + lead time) and emails the supplier; **Skip** records the reason and unticks **On order** so the item is checked again tomorrow.
- If anything was raised, the buyer gets **Confirm the stock counts** listing the items.

When goods arrive, update **On hand** and untick **On order** (or build a small goods-received form that does it).
