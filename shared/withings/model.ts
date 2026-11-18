/** Original weigh-in; never overwritten by an editable training day. */
export interface WeightMeasurement {
  sourceId: string;
  userId: string;
  groupId: string;
  measuredAt: string;
  timezone: string;
  localDate: string;
  weightKg: number;
}
