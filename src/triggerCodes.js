// EEG trigger codes — shared across all tasks
// Loaded as a plain script tag; exposes global TRIG object.
// All values fit in a single byte (1–255) for serial port compatibility.

const TRIG = {
  // Block markers (shared)
  BLOCK_PRACTICE:       1,
  BLOCK_TEST:           2,

  // SART — Sustained Attention to Response Task
  SART_DIGIT_GO:       10,   // go digit onset
  SART_DIGIT_NOGO:     11,   // no-go digit onset (digit 3)
  SART_MASK:           12,   // mask / ISI onset
  SART_HIT:            13,   // correct response on go trial
  SART_OMISSION:       14,   // no response on go trial
  SART_CORRECT_REJ:    15,   // correctly withheld on no-go
  SART_COMMISSION:     16,   // erroneous press on no-go

  // BART — Balloon Analogue Risk Task
  BART_BALLOON:        20,   // balloon appears
  BART_PUMP:           21,   // pump pressed (go or fatal)
  BART_POP:            22,   // balloon popped
  BART_COLLECT:        23,   // collect pressed
  BART_ITI:            24,   // inter-trial interval onset

  // MOT — Multi-Object Tracking (Speed and Capacity share the same codes)
  MOT_INIT:            30,   // trial start — circles spawn
  MOT_CUE:             31,   // targets flash red
  MOT_TRACK:           32,   // motion begins
  MOT_RESPONSE:        33,   // motion freezes — select targets
  MOT_SELECT:          34,   // circle tapped during response phase
  MOT_CONFIRM:         35,   // confirm button pressed (or timeout)
  MOT_CORRECT:         36,   // correct selection
  MOT_INCORRECT:       37,   // incorrect selection
};
