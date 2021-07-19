// #############################################################################
// ### 1 VARIABLES & PARAMETERS ###
// #############################################################################

// area of interest
var aoi = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017");
var country_name = "Indonesia";

// data
var era5 = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY");

// period
var yearStart = 2000;
var yearEnd = 2020;

// clustering
var n_clusters = 3;
var computeMonths = true;  // set to false to omit max_month and min_month

// styling and display
var printChart = false;
var coloredMonths = [
  "#0882ae", "#4ad5da", "#9cd93a",
  "#84c70e", "#4a9749", "#cf6d6a",
  "#d53853", "#cc4329", "#d95d0a",
  "#da8e05", "#c6045d", "#574fa8"
];

// export
var doExport = false;  // export file after calculation
var gsd = 10000;  // meters
var exportPath = "GoogleEarthEngine";  // Google Drive folder
var crs = "EPSG3857";  // without colon
var maxPixelCount = 1e13;  // max pixel count for export image (exp. form)

// #############################################################################
// ### 2 FUNCTIONS ###
// #############################################################################

var addMonth = function (image) {
  return image.addBands(ee.Image.constant(
    ee.Number.parse(image.date().format("MM"))).rename('month').int()
    .reproject(image.select("total_precipitation").projection())
  ).clip(aoi);
};

// #############################################################################
// ### 3 IMPLEMENTATION ###
// #############################################################################

var aoi = aoi.filterMetadata('country_na', 'equals', country_name);

var outline = ee.Image().byte().paint({
  featureCollection: aoi,
  color: 1,
  width: 2
});

var prcp = era5.select("total_precipitation")
  .filter(ee.Filter.calendarRange(yearStart, yearEnd, 'year'));

var reducers = ee.Reducer.minMax().combine({
  reducer2: ee.Reducer.mean(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.median(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.stdDev(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.mode(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.sum(),
  sharedInputs: true
});

var composite = prcp.reduce(reducers).clip(aoi);

if (computeMonths) {
  var prcp_times = prcp.map(addMonth);
  // turn image collection into an array
  var array = prcp_times.toArray();
  // sort array by the first band, keeping other bands
  var axes = {image: 0, band: 1};
  var sort = array.arraySlice(axes.band, 0, 1);  // select bands from index 0 to 1 (precipitation)
  var sorted = array.arraySort(sort);
  // take the first image only (MAX precipitation)
  var length = sorted.arrayLength(axes.image);
  // for the max value sorted
  var valuesMax = sorted.arraySlice(axes.image, length.subtract(1), length);
  // for the min value sorted
  var valuesMin = sorted.arraySlice(axes.image, 0, 1);
  // convert back to an image
  var max = valuesMax.arrayProject([axes.band]).arrayFlatten([['total_precipitation', 'month']]);
  var min = valuesMin.arrayProject([axes.band]).arrayFlatten([['total_precipitation', 'month']]);
  // get the min and max axis by selecting bands 0 and 1
  var timeMax = max.select(1).rename('max_month');  // get month
  var timeMin = min.select(1).rename('min_month');  // get month
  var composite_months = composite.addBands([timeMax, timeMin]);
  // make the training dataset
  var training_months = composite_months.sample({
    region: aoi,
    scale: prcp.first().projection().nominalScale(),  // 11000 m
    numPixels: 15000,
    // geometries: true
  });
  // instantiate the clusterer and train it
  var clusterer_months = ee.Clusterer.wekaKMeans(n_clusters).train(training_months);
  // cluster the input using the trained clusterer
  var result_months = composite_months.cluster(clusterer_months);
}

// make the training dataset
var training = composite.sample({
  region: aoi,
  scale: prcp.first().projection().nominalScale(),  // 11000 m
  numPixels: 15000,
  // geometries: true
});

// instantiate the clusterer and train it
var clusterer = ee.Clusterer.wekaKMeans(n_clusters).train(training);

// cluster the input using the trained clusterer
var result = composite.cluster(clusterer);

// #############################################################################
// ### 4 VISUALIZATION ###
// #############################################################################

// charts
if (printChart) {
  print("the chart is not implemented yet");
} else {
  print("making a chart is deactivated");
}

// map
Map.addLayer(outline, {palette: ["black"]}, "AOI");
Map.addLayer(composite, {}, "composite", 0);

// display the clusters with random colors.
if (computeMonths) {
  Map.addLayer(timeMin, {
    min: 1,
    max: 12,
    palette: coloredMonths
  }, "min precip month", false);
  Map.addLayer(timeMax, {
    min: 1,
    max: 12,
    palette: coloredMonths
  }, "max precip month", false);
  Map.addLayer(result_months.randomVisualizer(), {}, "clusters with months", false);
}
Map.addLayer(result.randomVisualizer(), {}, "clusters");
Map.centerObject(aoi, 5, true);

// #############################################################################
// ### 5 EXPORT ###
// #############################################################################

var expDate = ee.Date(Date.now());
var expDateStr = expDate.format("Y-MM-dd_HH-mm-ss-SSS");
var filename = expDateStr.getInfo() + "_Indonesia_clusters";
if (doExport) {
  Export.image.toDrive({
    image: result,
    description: filename,
    folder: exportPath,
    scale: gsd,
    crs: crs,
    maxPixels: maxPixelCount,
    region: aoi
  });
} else {
  print("export to Gdrive is deactivated");
}
