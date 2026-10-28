async function run(inputs, context, helpers) {
  const score = Number(inputs.score ?? 0)
  const customerName = String(inputs.customer_name ?? '').trim()

  if (Number.isNaN(score)) {
    throw new Error('score must be a valid number')
  }

  const scoreBand = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red'
  const subject = customerName || 'This record'

  helpers.log('Calculated workflow activity score band', {
    score,
    scoreBand,
    runId: context.runId,
  })

  return {
    outputs: {
      score_band: scoreBand,
      score_message: `${subject} scored ${score} and is in the ${scoreBand} band.`,
      evaluated_at: helpers.now(),
    },
  }
}

module.exports = run
