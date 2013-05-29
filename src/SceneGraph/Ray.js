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

 define( ['../Ray'], function(Ray) {
 
Ray.prototype.nodeIntersect = function( node, intersects )
{
	var intersects = intersects || [];
	
	for ( var i = 0; i < node.geometries.length; i++ ) 
	{
		this.geometryIntersect( node.geometries[i], intersects );
	}
	
	intersects.sort( function(a,b) {
		return a.t - b.t;
	});
	return intersects;
};

Ray.prototype.lodNodeIntersect = function( node, intersects )
{
	var intersects = intersects || [];
	
	if ( this.sphereIntersect( node.center, node.radius ) >= 0 )
	{	
		if ( node.children.length > 0 && node.childToLoad == 0 )
		{
			for ( var i = 0; i < node.children.length; i++ ) 
			{
				this.lodNodeIntersect( node.children[i], intersects );
			}
		}
		else
		{
			for ( var i = 0; i < node.geometries.length; i++ ) 
			{
				this.geometryIntersect( node.geometries[i], intersects );
			}
		}
	}
		
	return intersects;
};

Ray.prototype.geometryIntersect = function( geometry, intersects )
{
	var verts = geometry.mesh.vertices;
	for ( var i = 0; i < verts.length; i +=9 ) 
	{
		/*var intersect = this.triangleIntersect( [ verts[i], verts[i+1], verts[i+2] ],
					[ verts[i+3], verts[i+4], verts[i+5] ],
					[ verts[i+6], verts[i+7], verts[i+8] ] );*/
		var intersect = this.triangleIntersectOptimized( verts, i, i+3, i+6 );
		
		if (intersect)
		{
			intersect.geometry = geometry;
			intersects.push(intersect);
		}
	}
};

return Ray;

});