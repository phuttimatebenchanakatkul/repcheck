/* The billing toggle for pricing.html, and nothing else.

   Its own file rather than app.js, which no other page but index.html
   loads: that file is a 1,200-line IIFE for the home page's canvas,
   feature switcher and race walkthrough, and pulling all of it in for a
   two-button toggle would run a dozen guards to do nothing.

   And its own file rather than an inline <script>, which is what it was:
   one inline block on one page was the only thing standing between this
   site and a Content-Security-Policy of script-src 'self'. The
   alternatives were both worse -- 'unsafe-inline', which switches off the
   part of CSP that stops injected script, or a sha256 hash, which is
   strict but silently breaks this page the first time anyone edits a line
   of it. A file has neither problem.

   Classic script, like the rest of this site. */
(function () {
  "use strict";
  var group = document.querySelector(".rc-billing");
  var price = document.getElementById("pro-price");
  var per = document.getElementById("pro-per");
  var avg = document.getElementById("pro-avg");
  if (!group || !price || !per || !avg) return;

  // Only now does the toggle appear, and only now does the standalone yearly
  // block go away -- without this script both prices are simply on the page.
  document.documentElement.className += " rc-billing-on";

  var PLANS = {
    monthly: { amount: "$12", per: " / month", avg: false },
    yearly: { amount: "$120", per: " / year", avg: true }
  };
  var buttons = group.querySelectorAll(".rc-billing-opt");

  function show(key) {
    var plan = PLANS[key];
    if (!plan) return;
    // firstChild is the amount text node, ahead of the <span> carrying the
    // period -- replacing the whole innerHTML would drop the span the period
    // is read from on the next switch.
    price.firstChild.nodeValue = plan.amount;
    per.textContent = plan.per;
    avg.hidden = !plan.avg;
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-billing") === key;
      buttons[i].classList.toggle("is-on", on);
      // The pressed state is what a screen reader reads: the colour swap
      // below it says nothing on its own.
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function () {
      show(this.getAttribute("data-billing"));
    });
  }
})();
