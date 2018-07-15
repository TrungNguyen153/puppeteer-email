'use strict'

const delay = require('delay')
const faker = require('faker')
const tempy = require('tempy')

module.exports = async (user, opts) => {
  const {
    captchaSolver,
    smsNumberVerifier,
    browser
  } = opts

  const page = await browser.newPage()
  await page.goto('https://signup.live.com/signup')

  // email / username
  // ----------------

  await page.waitFor('#liveSwitch', { visible: true })
  await page.click('#liveSwitch', { delay: 10 })
  await delay(100)

  let error = null
  do {
    await page.type('#MemberName', user.username, { delay: 40 })
    await delay(250)
    await page.click('#iSignupAction', { delay: 20 })

    await delay(1000)
    error = await page.$('#MemberNameError')

    // TODO: there is an issue here where if one username fails, the next will
    // always also fail
    if (error) {
      await page.focus('#MemberName')
      for (let i = 0; i < user.username.length + 8; ++i) {
        await page.keyboard.press('Backspace')
      }

      await delay(1000)
      user.username = faker.internet.userName() + (Math.random() * 10000 | 0)
    }
  } while (error)

  console.log(JSON.stringify(user, null, 2))

  // password
  // -------------------

  await page.waitFor('#Password', { visible: true })
  await delay(100)
  await page.type('#Password', user.password, { delay: 10 })
  await delay(100)
  await page.click('#iOptinEmail', { delay: 10 })
  await delay(100)
  await page.click('#iSignupAction', { delay: 30 })

  // first and last name
  // -------------------

  await page.waitFor('#FirstName', { visible: true })
  await delay(100)
  await page.type('#FirstName', user.firstName, { delay: 30 })
  await delay(120)
  await page.type('#LastName', user.lastName, { delay: 35 })
  await delay(260)
  await page.click('#iSignupAction', { delay: 25 })

  // birth date
  // ----------

  await page.waitFor('#BirthMonth', { visible: true })
  await delay(100)
  await page.select('#BirthMonth', user.birthday.month)
  await delay(120)
  await page.select('#BirthDay', user.birthday.day)
  await delay(260)
  await page.select('#BirthYear', user.birthday.year)
  await delay(220)
  await page.click('#iSignupAction', { delay: 8 })

  // captcha and/or sms validation
  // -----------------------------

  await delay(1000)
  let waitForNavigation = true

  const waitForManualInput = async (msg) => {
    console.warn(msg)
    console.warn('waiting for manual input...')
    await page.waitForNavigation({ timeout: 200000 })
    waitForNavigation = false
  }

  // TODO: is it possible to go from sms verification to captcha or will it
  // always be captcha first?

  do {
    // captcha validation
    if (await page.$('#wlspispHipChallengeContainer')) {
      console.log('SMS NUMBER VALIDATION')

      // sms validation
      if (smsNumberVerifier) {
        const blacklist = new Set()
        const service = 'microsoft'
        let number

        do {
          number = await smsNumberVerifier.getNumber({ blacklist })

          await page.type('#wlspispHipChallengeContainer input[type=text]', number, { delay: 15 })
          await delay(200)
          await page.click('#wlspispHipControlButtonsContainer a[title="Send SMS code"]', { delay: 28 })

          let error = null
          await Promise.race([
            page.waitFor('#wlspispHipSolutionContainer input[type=text]', { visible: true }),
            page.waitFor('.alert-error[aria-hidden=false]', { visible: true })
              .then(() => page.$eval('.alert-error[aria-hidden=false]', (e) => e.innerText))
              .then((e) => { error = e })
          ])

          if (error) {
            console.warn('sms number error:', error.trim())
          } else {
            break
          }
        } while (true)

        const authCodes = await smsNumberVerifier.getAuthCodes({ number, service })
        console.log('sms request', service, number, authCodes)

        if (authCodes.length) {
          // TODO: likely won't work for multiple auth codes found because error will still be
          // present after first failure
          for (let i = 0; i < authCodes.length; ++i) {
            await page.type('#wlspispHipSolutionContainer input[type=text]', { visible: true })

            let error = false
            await Promise.all([
              page.click('#iSignupAction', { delay: 9 }),
              Promise.race([
                page.waitForNavigation({ timeout: 0 })
                  .then(() => { waitForNavigation = false }),
                // page.waitFor('.alert.alert-error', { visible: true })
                page.waitFor('.alert-error[aria-hidden=false]', { visible: true })
                  .then(() => page.$eval('.alert-error[aria-hidden=false]', (e) => e.innerText))
                  .then((e) => { error = e })
              ])
            ])

            if (error) {
              console.warn('sms code error', error.trim())
            } else {
              break
            }
          }
        }

        if (waitForNavigation) {
          await waitForManualInput('sms number verification failed')
        }
      } else {
        await waitForManualInput('sms number verification required')
      }
    } else if (await page.$('#hipTemplateContainer')) {
      console.log('CAPTCHA CHALLENGE')

      if (captchaSolver) {
        do {
          await page.waitFor('#hipTemplateContainer img[aria-label="Visual Challenge"]', { visible: true })

          const $img = await page.$('#hipTemplateContainer img[aria-label="Visual Challenge"]')
          const captchaPath = tempy.file({ extension: 'png' })
          await $img.screenshot({ path: captchaPath })

          console.log({ captchaPath })

          const taskId = await captchaSolver.createTask({
            type: 'image-to-text',
            image: captchaPath
          })
          console.log(`captcha task id: ${taskId}`)
          await delay(10000)

          const result = await captchaSolver.getTaskResult(taskId, {
            timeout: 60000,
            minTimeout: 8000,
            onFailedAttempt: (err) => {
              console.log(`Error getting captcha task result #${err.attemptNumber} failed. Retrying ${err.attemptsLeft} times left...`)
            }
          })
          console.log(`captcha task result: ${JSON.stringify(result, null, 2)}`)

          const solution = result && result.solution && result.solution.text
          await page.type('#hipTemplateContainer input', solution, { delay: 40 })

          // TODO: handle incorrect captcha result

          let error = false
          await Promise.all([
            page.click('#iSignupAction', { delay: 9 }),
            Promise.race([
              page.waitForNavigation({ timeout: 0 })
                .then(() => { waitForNavigation = false }),
              page.waitFor('.alert-error[aria-hidden=false]', { visible: true })
                .then(() => page.$eval('.alert-error[aria-hidden=false]', (e) => e.innerText))
                .then((e) => { error = e }),
              page.waitFor('#wlspispHipChallengeContainer', { visible: true })
            ])
          ])

          if (error) {
            console.warn('captcha solver error:', error)
          } else {
            break
          }
        } while (true)
      } else {
        await waitForManualInput('captcha solver required')
      }
    } else {
      await waitForManualInput('waiting for navigation')
    }
  } while (waitForNavigation)

  // main account page
  // -----------------

  await delay(500)
  await page.goto('https://www.outlook.com/?refd=account.microsoft.com&fref=home.banner.profile')

  // inbox page first-run
  // --------------------

  await delay(800)

  // keep pressing next...
  while (true) {
    if (!await page.$('.dialog button.nextButton')) break
    await page.click('.dialog button.nextButton', { delay: 5 })
    await delay(220)
  }

  // wait until "let's go" button appears...
  while (true) {
    await delay(1000)
    if (await page.$('.dialog button.primaryButton')) break
  }

  await delay(120)
  await Promise.all([
    page.waitForNavigation(),
    page.click('.dialog button.primaryButton', { delay: 7 })
  ])

  // should now be at https://outlook.live.com/mail/inbox
  await page.close()
}
