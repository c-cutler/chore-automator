import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

const KEYS = {
	person1Name: 'Person 1',
	person2Name: 'Person 2',
	person1Chores: 'Person 1 chores',
	person2Chores: 'Person 2 chores',
	person1ExtendedChores: 'Person 1 extended chores',
	person2ExtendedChores: 'Person 2 extended chores',
	person1ActiveExtended: 'Person 1 active extended chore',
	person2ActiveExtended: 'Person 2 active extended chore',
}

function ensureArray(value, keyName) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`Missing or empty Redis array for key: ${keyName}`)
	}

	return value
}

function findExtendedIndex(extendedChores, activeExtendedChore) {
	if (!activeExtendedChore) {
		return 0
	}

	const index = extendedChores.indexOf(activeExtendedChore)
	return index >= 0 ? index : 0
}

function buildSlackMessage(assignments) {
	const lines = ['Chore time!', '']

	for (const assignment of assignments) {
		lines.push(`${assignment.name}, your chores are as follows:`)
		lines.push('')

		for (let index = 0; index < assignment.chores.length; index += 1) {
			lines.push(`${index + 1} - ${assignment.chores[index]}`)
		}

		lines.push(`${assignment.chores.length + 1} - ${assignment.extendedChore}`)
		lines.push('')
	}

	return lines.join('\n').trimEnd()
}

async function postToSlack(text) {
	const webhookUrl = process.env.SLACK_WEBHOOK
	if (!webhookUrl) {
		throw new Error('Missing required env var: SLACK_WEBHOOK')
	}

	const payload = { text }

	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})

	if (!response.ok) {
		const body = await response.text()
		throw new Error(`Slack webhook failed (${response.status}): ${body}`)
	}
}

async function main() {
	const [
		person1Name,
		person2Name,
		person1ChoresRaw,
		person2ChoresRaw,
		person1ExtendedRaw,
		person2ExtendedRaw,
		person1ActiveExtended,
		person2ActiveExtended,
	] = await Promise.all([
		redis.get(KEYS.person1Name),
		redis.get(KEYS.person2Name),
		redis.get(KEYS.person1Chores),
		redis.get(KEYS.person2Chores),
		redis.get(KEYS.person1ExtendedChores),
		redis.get(KEYS.person2ExtendedChores),
		redis.get(KEYS.person1ActiveExtended),
		redis.get(KEYS.person2ActiveExtended),
	])

	if (!person1Name || !person2Name) {
		throw new Error('Missing person assignment keys in Redis (Person 1 / Person 2)')
	}

	const person1Chores = ensureArray(person1ChoresRaw, KEYS.person1Chores)
	const person2Chores = ensureArray(person2ChoresRaw, KEYS.person2Chores)
	const person1ExtendedChores = ensureArray(person1ExtendedRaw, KEYS.person1ExtendedChores)
	const person2ExtendedChores = ensureArray(person2ExtendedRaw, KEYS.person2ExtendedChores)

	const person1ExtendedIndex = findExtendedIndex(person1ExtendedChores, person1ActiveExtended)
	const person2ExtendedIndex = findExtendedIndex(person2ExtendedChores, person2ActiveExtended)

	const assignments = [
		{
			name: person1Name,
			chores: person1Chores,
			extendedChore: person1ExtendedChores[person1ExtendedIndex],
		},
		{
			name: person2Name,
			chores: person2Chores,
			extendedChore: person2ExtendedChores[person2ExtendedIndex],
		},
	]

	const message = buildSlackMessage(assignments)

	await postToSlack(message)

	const nextPerson1ExtendedIndex = (person1ExtendedIndex + 1) % person1ExtendedChores.length
	const nextPerson2ExtendedIndex = (person2ExtendedIndex + 1) % person2ExtendedChores.length

	await Promise.all([
		redis.set(KEYS.person1Name, person2Name),
		redis.set(KEYS.person2Name, person1Name),
		redis.set(KEYS.person1ActiveExtended, person1ExtendedChores[nextPerson1ExtendedIndex]),
		redis.set(KEYS.person2ActiveExtended, person2ExtendedChores[nextPerson2ExtendedIndex]),
	])

	console.log(`Weekly notification sent`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})