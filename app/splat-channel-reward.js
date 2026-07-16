/**
 * Configuration options
 */
const CONFIG = {
  // The title of the Channel Point Reward that will trigger the effect
  rewardTitle: 'SPLAT',
};

// Support both the existing custom trigger and the original channel-point reward.
window.client.on("General.Custom", (wsdata) => {
  console.log(wsdata);
  if (wsdata.data.fromHtmlOverlayPlayVideo === true) {
    newSplat();
  }
});

window.client.on('Twitch.RewardRedemption', (message) => {
  if ((message.data.reward.title || message.data.title) === CONFIG.rewardTitle) {
    newSplat();
  }
});


// Below code slightly adapted from https://codepen.io/jonobr1/pen/wvqRLbR
import Two from 'https://cdn.skypack.dev/two.js@latest';

var squished = true;
var outside = true;

var two = new Two({
  type: Two.Types.svg,
  fullscreen: true
}).appendTo(document.body);

var radius = two.height / 3;
var resolution = 32;
var circle = new Two.Circle(0, 0, radius, resolution);
var blob = new Two.Path(circle.vertices);
blob.fill = 'rgba(0,0,0,0)';
blob.noStroke();

blob.closed = true;
blob.curved = true;
blob.automatic = true;

two.add(blob);

two.bind('update', update).play();

function update() {
  if (!squished) {

    for (var i = 0; i < blob.vertices.length; i++) {
      var v = blob.vertices[i];
      var d = v.destination;

      if (v.equals(d)) {
        squished = true;
        break;
      }

      v.x += (d.x - v.x) * 0.05;
      v.y += (d.y - v.y) * 0.05;
    }

    return;
  }

  if (outside) return;

  outside = true;

  for (var i = 0; i < blob.vertices.length; i++) {
    var v = blob.vertices[i];
    v.y += v.step;
    v.step *= 1.025;
    if (v.y < two.height) {
      outside = false;
    }
  }
}

function newSplat() {
  blob.fill = 'black';
  blob.translation.set(two.width / 2, two.height / 2);

  squished = false;
  outside = false;

  for (var i = 0; i < blob.vertices.length; i++) {
    var v = blob.vertices[i];
    var pct = (i + 1) / blob.vertices.length;
    var theta = pct * Math.PI * 2;
    var radius = Math.random() * two.height / 3 + two.height / 6;
    var x = radius * Math.cos(theta);
    var y = radius * Math.sin(theta);
    v.set(two.height / 3 * Math.cos(theta), two.height / 3 * Math.sin(theta));
    v.destination = new Two.Vector(x, y);
    v.step = Math.sqrt(Math.random()) + 2;
  }

}
