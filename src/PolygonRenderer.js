/***************************************
 * Copyright 2011, 2012 GlobWeb contributors.
 *
 * This file is part of GlobWeb.
 *
 * GlobWeb is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, version 3 of the License, or
 * (at your option) any later version.
 *
 * GlobWeb is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with GlobWeb. If not, see <http://www.gnu.org/licenses/>.
 ***************************************/
 
define( ['./Utils','./VectorRenderer','./VectorRendererManager','./FeatureStyle','./Program','./Triangulator'], 
	function(Utils,VectorRenderer,VectorRendererManager,FeatureStyle,Program,Triangulator) {

/**************************************************************************************************************/

/** @constructor
 *	Basic renderer for polygon
 */

var PolygonRenderer = function(globe)
{
	VectorRenderer.prototype.constructor.call( this, globe );
	this.maxTilePerGeometry = 0;
	this.renderContext = globe.renderContext;
	this.defaultVertexShader = "\
		attribute vec3 vertex;\n\
		uniform mat4 mvp;\n\
		void main(void) \n\
		{\n\
			gl_Position = mvp * vec4(vertex, 1.0);\n\
		}\n\
	";

	this.extrudeVertexShader = "\
		attribute vec3 vertex;\n\
		attribute vec4 normal;\n\
		uniform float extrusionScale; \n\
		uniform mat4 mvp;\n\
		void main(void) \n\
		{\n\
			vec3 extrudedVertex = vertex + normal.w * vec3(normal.x, normal.y, normal.z) * extrusionScale;\
			gl_Position = mvp * vec4(extrudedVertex, 1.0);\n\
		}\n\
	";

	this.fragmentShader = "\
	precision lowp float; \n\
	uniform vec4 u_color;\n\
	void main(void)\n\
	{\n\
		gl_FragColor = u_color;\n\
	}\n\
	";
	this.currentVertexShader = this.defaultVertexShader;
	this.program = new Program(globe.renderContext);
	this.program.createFromSource(this.defaultVertexShader, this.fragmentShader);
}

/**************************************************************************************************************/

Utils.inherits(VectorRenderer,PolygonRenderer);

/**************************************************************************************************************/

/**
 * Renderable constructor for Polygon
 */
var PolygonRenderable = function(bucket) 
{
	this.bucket = bucket;
	this.geometry = null;
	this.matrix = mat4.create();
	this.vertexBuffer = null;
	this.indexBuffer = null;
	this.normalBuffer = null;
}

/**************************************************************************************************************/

/**
 *	Extract coordinates from the given geometry as array
 */
var _extractCoordinates = function(geometry)
{
	var coordinates = [];
	if ( geometry.type == "MultiPolygon" )
	{
		for ( var i = 0; i<geometry['coordinates'].length; i++ )
		{
			var coords = geometry['coordinates'][i][0];
			coordinates.push(coords);	
		}
	}
	else
	{
		// Polygon
		coordinates.push(geometry['coordinates'][0]);
	}
	return coordinates;
}

/**************************************************************************************************************/

/**
 * Add a geometry to the renderbale
 * Vertex buffer : geometry|extrude
 * Index buffer : geometry triangles|extrude triangles|lines
 * Normal buffer : normals.xyz, extrude value as w 
 */
PolygonRenderable.prototype.add = function(geometry)
{
	this.geometry = geometry;

	var renderer = this.bucket.renderer;
	var gl = renderer.tileManager.renderContext.gl;
	var style = this.bucket.style;
		
	var lastIndex = 0;
	var coordinates = _extractCoordinates(geometry);
	var vertices = [];
	var indices = [];
	var lineIndices = [];
	var normals = [];

	var origin = vec3.create();
	// TODO: Find a better way to access to coordinate system 
	var coordinateSystem = geometry._bucket.layer.globe.coordinateSystem;
	coordinateSystem.fromGeoTo3D(coordinates[0][0], origin);

	for ( var n=0; n<coordinates.length; n++ ) {

		var coords = coordinates[n];

		// Build upper polygon vertices
		var clockwise = 0;
		var offset = lastIndex * 3;
		for ( var i=0; i < coords.length; i++)
		{
			var pos3d = [];
			// Always use coordinates at zero height on vertex construction, height will be taken into account on extrude
			var coordAtZero = [ coords[i][0], coords[i][1], 0.0 ];
			coordinateSystem.fromGeoTo3D(coordAtZero, pos3d);
			vertices[offset] = pos3d[0] - origin[0];
			vertices[offset+1] = pos3d[1] - origin[1];
			vertices[offset+2] = pos3d[2] - origin[2];

			// Find out if its vertices ordered clockwise to build index buffer properly
			if ( i < coords.length - 1 ) {
				clockwise += (coords[i+1][0] - coords[i][0]) * (coords[i+1][1] + coords[i][1]);
			}

			if ( style.extrude )
			{
				// Update vertex shader to extrude one
				renderer.setVertexShader(renderer.extrudeVertexShader);

				// Compute normals
				var normal = vec3.create(pos3d);
				vec3.normalize(normal);
				normals.push(normal[0]);
				normals.push(normal[1]);
				normals.push(normal[2]);
				var extrudeValue;
				if ( typeof style.extrude == "boolean" )
				{
					// Extrude value extracted from KML, use the height coordinate
					extrudeValue = coords[i][2];
				}
				else
				{
					// Extrude value is a float defined by user
					extrudeValue = style.extrude;
				}
				normals.push(extrudeValue * coordinateSystem.heightScale);
			}

			offset += 3;
		}

		// Build bottom polygon vertices on extrude
		if ( style.extrude )
		{
			// Use same vertices as upper polygon
			var offset = lastIndex * 3;
			vertices = vertices.concat( vertices.slice(offset, offset + coords.length*3) );
			// Add normals without extrude value
			for ( var i=0; i < coords.length; i++)
			{
				var normal = vec3.create(pos3d);
				vec3.normalize(normal);
				normals.push(normal[0]);
				normals.push(normal[1]);
				normals.push(normal[2]);
				normals.push(0);
				offset += 3;
			}
		}
		
		// Build triangle indices for upper polygon
		// Create index array(make shared ?)
		var currentIndices = Triangulator.process( coords );
		if ( currentIndices == null )
		{
			console.error("Triangulation error ! Check if your GeoJSON geometry is valid");
			return false;
		}
		for ( var i=0; i<currentIndices.length; i++ )
		{
			indices.push(lastIndex + currentIndices[i]);
		}

		// Build side triangle indices
		if ( style.extrude )
		{
			var upOffset = lastIndex;
			var lowOffset = lastIndex + coords.length;
			
			for ( var i = 0; i < coords.length-1; i++ )
			{
				// Depending on vertice order, push the
				if ( clockwise > 0 )
				{
					indices.push( upOffset, upOffset + 1, lowOffset );
					indices.push( upOffset + 1, lowOffset + 1, lowOffset );	
				}
				else
				{
					indices.push( upOffset, lowOffset, upOffset + 1 );
					indices.push( upOffset + 1, lowOffset, lowOffset + 1 );
				}
				upOffset += 1;
				lowOffset += 1;
			}
		}

		// Build line indices for upper polygon
		var offset = 0;
		for ( var i = 0; i < coords.length-1; i++ )
		{
			lineIndices.push( lastIndex + offset, lastIndex + offset + 1 );
			offset += 1;
		}

		// Build top-to-bottom line indices
		if ( style.extrude )
		{
			var upOffset = lastIndex;
			var lowOffset = lastIndex + coords.length;
			for ( var i = 0; i < coords.length-1; i++ )
			{
				lineIndices.push( upOffset, lowOffset );
				
				upOffset += 1;
				lowOffset += 1;
			}
		}

		// Update last index
		if ( style.extrude )
		{
			lastIndex += coords.length * 2;
		}
		else
		{
			lastIndex += coords.length;
		}

	}

	this.numTriIndices = indices.length;
	this.numLineIndices = lineIndices.length;
	// Index buffer contains triange indices and lines one
	indices = indices.concat(lineIndices);

	// Create vertex buffer
	this.vertexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array( vertices ), gl.STATIC_DRAW);	

	// Create index buffer
	this.indexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
	
	if ( style.extrude )
	{
		// Create normal buffer
		this.normalBuffer = gl.createBuffer();
	    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
	    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
	}

	mat4.identity(this.matrix);
	mat4.translate(this.matrix,origin);

	// Always add the geometry
	return true;
}

/**************************************************************************************************************/

/**
 * Remove a geometry from the renderable
 */
PolygonRenderable.prototype.remove = function(geometry)
{
	if ( this.geometry == geometry)
	{
		this.geometry = null;
		// Since there is only one geometry per bucket
		// return 0 to dispose geometry resources
		return 0;
	}
}

/**************************************************************************************************************/

/**
 * Dispose the renderable
 */
PolygonRenderable.prototype.dispose = function(renderContext)
{
	var gl = renderContext.gl;
	if (this.vertexBuffer) gl.deleteBuffer( this.vertexBuffer );
	if (this.normalBuffer) gl.deleteBuffer( this.normalBuffer );
	if (this.indexBuffer) gl.deleteBuffer( this.indexBuffer );
}


/**************************************************************************************************************/

/**
	Bucket constructor for PolygonRenderer
 */
var PolygonBucket = function(layer,style)
{
	this.layer = layer;
	this.style = style;
	this.renderer = null;
}

/**************************************************************************************************************/

/**
	Create a renderable for this bucket
 */
PolygonBucket.prototype.createRenderable = function()
{
	return new PolygonRenderable(this);
}

/**************************************************************************************************************/

/**
	Check if a bucket is compatible
 */
PolygonBucket.prototype.isCompatible = function(style)
{
	return false;
}

/**************************************************************************************************************/

/**
 * 	Render all the polygons
 */
PolygonRenderer.prototype.render = function(renderables, start, end)
{
	var renderContext = this.globe.renderContext;
	var gl = renderContext.gl;
	
	gl.enable(gl.BLEND);
	gl.blendEquation(gl.FUNC_ADD);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.depthFunc(gl.LEQUAL);
	//gl.enable(gl.POLYGON_OFFSET_FILL);
	//gl.polygonOffset(-2.0,-2.0);
	//gl.disable(gl.DEPTH_TEST);
	
	// Compute the viewProj matrix
	var viewProjMatrix = mat4.create();
	mat4.multiply(renderContext.projectionMatrix, renderContext.viewMatrix, viewProjMatrix);
	
	var modelViewProjMatrix = mat4.create();
	for ( var n = start; n < end; n++ )
	{
		var renderable = renderables[n];
		
		// Setup program
		this.program.apply();
		
		mat4.multiply(viewProjMatrix,renderable.matrix,modelViewProjMatrix);
		gl.uniformMatrix4fv(this.program.uniforms["mvp"], false, modelViewProjMatrix);
		
		var style = renderable.bucket.style;
		gl.uniform4f(this.program.uniforms["u_color"], style.fillColor[0], style.fillColor[1], style.fillColor[2], 
				style.fillColor[3] * renderable.bucket.layer._opacity);  // use fillColor
		
		gl.bindBuffer(gl.ARRAY_BUFFER, renderable.vertexBuffer);
		gl.vertexAttribPointer(this.program.attributes['vertex'], 3, gl.FLOAT, false, 0, 0);
		
		if ( renderable.normalBuffer )
		{
			gl.bindBuffer(gl.ARRAY_BUFFER, renderable.normalBuffer);
			gl.vertexAttribPointer(this.program.attributes['normal'], 4, gl.FLOAT, false, 0, 0);
			gl.uniform1f(this.program.uniforms["extrusionScale"], style.extrusionScale);
		}

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderable.indexBuffer);
		
		gl.drawElements( gl.TRIANGLES, renderable.numTriIndices, gl.UNSIGNED_SHORT, 0);
		if ( renderable.numLineIndices > 0 )
		{
			gl.uniform4f(this.program.uniforms["u_color"], style.strokeColor[0], style.strokeColor[1], style.strokeColor[2], style.strokeColor[3] * renderable.bucket.layer._opacity);  
			gl.drawElements( gl.LINES, renderable.numLineIndices, gl.UNSIGNED_SHORT, renderable.numTriIndices * 2);
		}
	}
	
	//gl.enable(gl.DEPTH_TEST);
	//gl.disable(gl.POLYGON_OFFSET_FILL);
	gl.depthFunc(gl.LESS);
	gl.disable(gl.BLEND);
}

/**************************************************************************************************************/

/**
	Check if renderer is applicable
 */
PolygonRenderer.prototype.canApply = function(type,style)
{
	return (type == "Polygon" || type == "MultiPolygon") && style.fill;
}

/**************************************************************************************************************/

/**
	Create a bucket
 */
PolygonRenderer.prototype.createBucket = function(layer,style)
{
	return new PolygonBucket(layer,style);
}

/**************************************************************************************************************/

/**
	Set the given vertex shader
 */
PolygonRenderer.prototype.setVertexShader = function(vertexShader) {
	if ( this.currentVertexShader != vertexShader )
	{
		this.program.dispose();
		this.program = new Program(this.globe.renderContext);
		this.program.createFromSource( vertexShader, this.fragmentShader );
		this.currentVertexShader = vertexShader;
	}
};

/**************************************************************************************************************/

// Register the renderer
VectorRendererManager.factory.push( function(globe) { return new PolygonRenderer(globe); } );

});